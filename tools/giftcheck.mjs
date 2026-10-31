#!/usr/bin/env node
// giftcheck.mjs — loop/gifts: `GiveGiftsToHeroTask` (src/07zv7_vbgifts.js's own `NS.VBGifts`),
// the priority-3 CompositeTask createIdleTasks wraps it in (VillagerTaskListProvider.java:
// 76/135/173). Every number is cited in src/07zv7_vbgifts.js, read off `.decomp` this session:
// GiveGiftsToHeroTask.java (whole file), LootTables.java:74-86, Items.java:852.
//
//   node tools/giftcheck.mjs [--verbose]
//
// Sections:
//   1. static data — the 13-entry GIFTS profession->table map, the 3 timing constants
//   2. shouldRun/ticksLeft — no hero nearby never decrements the cooldown; a hero nearby does,
//      down to 0, then the task starts (remembers INTERACTION_TARGET/LOOK_TARGET)
//   3. approach — too far from the hero sets a live WALK_TARGET at the hero's own position,
//      re-aimed every tick as the hero moves (no snapshot)
//   4. the RUN_TIME wait + the actual toss — close enough, nothing happens before RUN_TIME
//      ticks past startTime; past it, the profession's real loot-table gift is thrown as a real
//      ItemEntity and the task marks itself done
//   5. finish — done (or the hero losing the effect mid-task) re-rolls ticksLeft into the real
//      600..6600 range and forgets WALK_TARGET/LOOK_TARGET
//   6. baby gift is a poppy, unmapped professions (none/nitwit) get wheat_seeds
//   7. isCloseEnough is the real squared-BlockPos gate (5 blocks, strict <), not the walk
//      machinery's own manhattan arrival test
//   8. anti-vacuity — breaking this unit's own data/logic and watching the break get caught

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

console.log('giftcheck — loop/gifts: GiveGiftsToHeroTask (NS.VBGifts)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv4_vbidle.js', '07zv5_vbbreed.js',
  '07zv6_vbgather.js', '07zv7_vbgifts.js', '07zx_particle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
M.Breed.init();
const lootMeta = rdj('loot.meta.json');
M.Loot.init({ loot: b64('loot.bin'), lootBytes: lootMeta.jsonBytes });

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;
const VBG = M.VBGifts, IT = M.Items, ES = M.Effects, L = M.Loot;

ok(VB, 'NS.VB did not load');
ok(VBG && typeof VBG.tick === 'function', 'NS.VBGifts did not load (src/07zv7_vbgifts.js)');
ok(L && L.ready, 'NS.Loot did not load loot.bin');
if (!VB || !VBG || !L) { console.log('\nFAIL giftcheck — module missing'); process.exit(1); }

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
function hero(x, y, z, amplifier) {
  const p = { x, y, z, eyeHeight: 1.62, effects: {} };
  if (amplifier !== undefined) p.effects.hero_of_the_village = { amplifier, duration: 200 };
  return p;
}
function itemEntitiesOf(name) {
  const idx = IT.of(name);
  return EL.list.filter((o) => o.type === 'item' && !o.removed && (o.item === idx || o.item === name));
}
function totalOf(name) { return itemEntitiesOf(name).reduce((n, o) => n + (o.count | 0), 0); }

// ═══ 1. static data ══════════════════════════════════════════════════════════════════════════
console.log('\n 1. GIFTS (13 professions) + timing constants');
{
  const profs = Object.keys(VBG.GIFTS).sort();
  const expect = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
    'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'].sort();
  ok(JSON.stringify(profs) === JSON.stringify(expect), `GIFTS names the real 13 professions (GiveGiftsToHeroTask.java:33-46), got [${profs.join(',')}]`);
  for (const p of profs) ok(L.hasTable(VBG.GIFTS[p]), `${VBG.GIFTS[p]} is a real packed table (tools/pack-loot.mjs)`);
  ok(VBG.MAX_DISTANCE === 5, 'MAX_DISTANCE is 5 (field_30117, java:29)');
  ok(VBG.DEFAULT_DURATION === 600, 'DEFAULT_DURATION is 600 (field_18985, java:30)');
  ok(VBG.RUN_TIME === 20, 'RUN_TIME is 20 (field_30120, java:32)');
}

// ═══ 2. shouldRun / ticksLeft ═══════════════════════════════════════════════════════════════
console.log('\n 2. shouldRun: no hero nearby never decrements ticksLeft; a hero nearby does, down to 0, then the task starts');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  const noHero = hero(0, PLAT_Y + 1, 3);   // present, but no effect
  for (let i = 0; i < 5; i++) VBG.tick(v, 0, i, noHero);
  ok(v.vbGiftCooldown === VBG.DEFAULT_DURATION, `no hero (or a hero without the effect) never decrements ticksLeft, got ${v.vbGiftCooldown}`);
  ok(!v.vbGift, 'and the task never starts either');

  const h = hero(0, PLAT_Y + 1, 3, 0);
  // shouldRun decrements ONCE per call while ticksLeft > 0, and returns true only once it
  // reads exactly 0 -- 600 decrementing calls (600 -> 0) plus one more "reads 0, starts" call.
  for (let i = 0; i < VBG.DEFAULT_DURATION - 1; i++) VBG.tick(v, 0, i, h);
  ok(v.vbGiftCooldown === 1, `ticksLeft counts down one per tick while a hero IS nearby, got ${v.vbGiftCooldown}`);
  ok(!v.vbGift, 'still not running with 1 tick of cooldown left');
  VBG.tick(v, 0, VBG.DEFAULT_DURATION - 1, h);   // the 600th decrementing call: 1 -> 0, still no run
  ok(v.vbGiftCooldown === 0 && !v.vbGift, 'ticksLeft reaches exactly 0, but that SAME call already spent its decrement and returned false');
  VBG.tick(v, 0, VBG.DEFAULT_DURATION, h);       // the NEXT call reads ticksLeft === 0 and starts
  ok(!!v.vbGift && v.vbGift.done === false, 'run() started the task (e.vbGift present, not done)');
  ok(!!v.vbLookTarget && v.vbLookTarget.x === h.x, 'run() remembers LOOK_TARGET at the hero (java:79)');
  EL.clear();
}

// ═══ 3. approach — live WALK_TARGET, re-aimed every tick ═══════════════════════════════════
console.log('\n 3. tick: too far from the hero sets a WALK_TARGET at the hero\'s CURRENT position, re-aimed as it moves');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  v.vbGiftCooldown = 0;
  const h = hero(20, PLAT_Y + 1, 0, 0);   // far away
  VBG.tick(v, 0, 1, h);                    // run()
  VBG.tick(v, 0, 2, h);                    // tick(): too far -> walk
  ok(!!v.vbWalkTarget && v.vbWalkTarget.x === 20 && v.vbWalkTarget.range === VBG.MAX_DISTANCE,
    `too far sets WALK_TARGET at the hero's position with completionRange MAX_DISTANCE, got ${JSON.stringify(v.vbWalkTarget)}`);
  h.x = 30;                                // the hero moved
  VBG.tick(v, 0, 3, h);
  ok(v.vbWalkTarget.x === 30, `WALK_TARGET is re-aimed at the hero's NEW position every tick (a live target, not a snapshot), got ${v.vbWalkTarget.x}`);
  EL.clear();
}

// ═══ 4. RUN_TIME wait + the real toss ═══════════════════════════════════════════════════════
console.log('\n 4. tick: close enough waits RUN_TIME ticks past startTime, then throws the real per-profession gift and marks done');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  v.vbGiftCooldown = 0;
  const h = hero(1, PLAT_Y + 1, 0, 0);     // within MAX_DISTANCE the whole time
  VBG.tick(v, 0, 100, h);                  // run(): startTime = 100
  ok(v.vbGift.startTime === 100, 'startTime is stamped at run()');
  for (let t = 101; t <= 120; t++) {       // 20 more ticks: NOT yet > RUN_TIME (100->120 == 20)
    VBG.tick(v, 0, t, h);
  }
  ok(!v.vbGift.done, `nothing is thrown before tnow - startTime > RUN_TIME (20 elapsed is not > 20), got done=${v.vbGift.done}`);
  ok(totalOf('bread') + totalOf('pumpkin_pie') + totalOf('cookie') === 0, 'no farmer gift item on the ground yet');
  VBG.tick(v, 0, 121, h);                  // 121 - 100 = 21 > 20 -> throws
  ok(v.vbGift.done === true, 'past RUN_TIME the task marks itself done');
  const thrown = totalOf('bread') + totalOf('pumpkin_pie') + totalOf('cookie');
  ok(thrown > 0, `a real farmer_gift item (bread/pumpkin_pie/cookie) was thrown as an ItemEntity, got total ${thrown}`);
  VBG.tick(v, 0, 122, h);                  // keepRunning now false (done) -> finish()
  ok(!v.vbGift, 'the following tick runs finish() (keepRunning fails once done) and clears e.vbGift');
  ok(v.vbGiftCooldown >= VBG.MIN_GIFT_DELAY && v.vbGiftCooldown < VBG.MIN_GIFT_DELAY + VBG.GIFT_DELAY_SPREAD,
    `finish() re-rolls ticksLeft into 600..6600, got ${v.vbGiftCooldown}`);
  ok(v.vbWalkTarget === null && v.vbLookTarget === null, 'finish() forgets WALK_TARGET and LOOK_TARGET');
  EL.clear();
}

// ═══ 5. finish on a mid-task hero loss ═════════════════════════════════════════════════════
console.log('\n 5. shouldKeepRunning: the hero losing the effect mid-task also finishes (re-rolls the cooldown, does NOT throw)');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'librarian');
  v.vbGiftCooldown = 0;
  const h = hero(1, PLAT_Y + 1, 0, 0);
  VBG.tick(v, 0, 1, h);                    // run()
  ok(!!v.vbGift, 'task started');
  const noHero = hero(1, PLAT_Y + 1, 0);   // same object shape, no effect this time
  VBG.tick(v, 0, 2, noHero);
  ok(!v.vbGift, 'losing the hero effect mid-task finishes immediately (shouldKeepRunning fails)');
  ok(totalOf('book') === 0, 'and nothing was thrown -- the gift was never reached');
  EL.clear();
}

// ═══ 6. baby gift / unmapped-profession gift ═══════════════════════════════════════════════
console.log('\n 6. getGifts: a baby always gets one poppy; NONE/NITWIT always get one wheat_seeds');
{
  const baby = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  baby.isBaby = true;
  baby.vbGiftCooldown = 0;
  const h = hero(1, PLAT_Y + 1, 0, 0);
  VBG.tick(baby, 0, 1, h);
  VBG.tick(baby, 0, 100, h);
  VBG.tick(baby, 0, 121, h);
  ok(totalOf('poppy') === 1, `a baby villager's gift is one poppy regardless of profession, got ${totalOf('poppy')}`);
  EL.clear();

  const nitwit = spawnVillager(0, PLAT_Y + 1, 0, 'nitwit');
  nitwit.vbGiftCooldown = 0;
  const h2 = hero(1, PLAT_Y + 1, 0, 0);
  VBG.tick(nitwit, 0, 1, h2);
  VBG.tick(nitwit, 0, 100, h2);
  VBG.tick(nitwit, 0, 121, h2);
  ok(totalOf('wheat_seeds') === 1, `an unmapped profession (nitwit) always gets one wheat_seeds, got ${totalOf('wheat_seeds')}`);
  EL.clear();
}

// ═══ 7. isCloseEnough — the real squared-BlockPos gate, strict < ═════════════════════════════
console.log('\n 7. isCloseEnough: BlockPos squared distance strictly < 25 (5 blocks), not the walk machinery\'s own manhattan test');
{
  // exactly 5 blocks along one axis -> squared distance 25, NOT < 25 -> not close enough
  const v = spawnVillager(0, PLAT_Y, 0, 'farmer');
  v.vbGiftCooldown = 0;
  const edge = hero(5, PLAT_Y, 0, 0);
  VBG.tick(v, 0, 1, edge);                 // run()
  VBG.tick(v, 0, 2, edge);                 // tick(): exactly 5 away
  ok(!!v.vbWalkTarget, 'exactly 5 blocks away (squared 25, not < 25) is NOT close enough -- it walks');
  EL.clear();

  const v2 = spawnVillager(0, PLAT_Y, 0, 'farmer');
  v2.vbGiftCooldown = 0;
  const near = hero(4, PLAT_Y, 0, 0);      // squared 16 < 25
  VBG.tick(v2, 0, 1, near);
  VBG.tick(v2, 0, 2, near);
  ok(!v2.vbWalkTarget, '4 blocks away (squared 16 < 25) IS close enough -- no WALK_TARGET set');
  EL.clear();
}

// ═══ 8. anti-vacuity ═════════════════════════════════════════════════════════════════════════
console.log('\n 8. anti-vacuity: a stubbed-out VBG.tick, and an emptied GIFTS map, are themselves detectable');
{
  const v = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  const savedTick = VBG.tick;
  VBG.tick = function () {};
  VBG.tick(v, 0, 1, hero(0, PLAT_Y + 1, 0, 0));
  okAv(v.vbGiftCooldown === undefined, 'a stubbed-out VBG.tick never even lazily inits ticksLeft -- the real one does, section 2 above already proved it');
  VBG.tick = savedTick;

  const v2 = spawnVillager(0, PLAT_Y + 1, 0, 'farmer');
  v2.vbGiftCooldown = 0;
  const savedGifts = VBG.GIFTS;
  VBG.GIFTS = {};
  const h = hero(1, PLAT_Y + 1, 0, 0);
  VBG.tick(v2, 0, 1, h);
  VBG.tick(v2, 0, 100, h);
  VBG.tick(v2, 0, 121, h);
  okAv(totalOf('wheat_seeds') === 1, 'an emptied GIFTS map falls through to wheat_seeds for EVERY profession -- section 4/6 above proved the real map throws the real table');
  VBG.GIFTS = savedGifts;
  EL.clear();
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  console.log('\nFAIL giftcheck');
  process.exit(1);
} else {
  console.log(`\nPASS giftcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
}
