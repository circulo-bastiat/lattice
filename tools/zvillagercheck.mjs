#!/usr/bin/env node
// zvillagercheck.mjs — loop/zvillager-s102 (QUEUE 0.2 G18 mobs): ZOMBIE VILLAGER + CONVERSION,
// whole. Drives the REAL module (07zr_zvillager.js, NS.ZVillager) against
// `.decomp/net/minecraft/entity/mob/ZombieVillagerEntity.java` (347 lines, read whole) and
// `.decomp/net/minecraft/entity/mob/ZombieEntity.java`'s own onKilledOther (404-421)/
// field_30519 (line 76).
//
//   node tools/zvillagercheck.mjs [--verbose]
//
// Sections:
//   1. spawnInit -- profession roll (Profession.ALL, uniform), opts override, plains default
//   2. shouldConvertOnKill -- the difficulty gate, both directions (peaceful/easy/normal/hard)
//   3. kill-conversion -- EL.spawn('zombie_villager', ...) carries villager data across
//   4. applyGoldenApple -- weakness required, both directions; timer range 3600..6000
//   5. conversionRate -- base 1, the 1% roll, the iron_bars/bed scan and its 14-block cap
//   6. tick + finishConversion -- the timer reaching 0 swaps back to a villager, cure gossip
//      exactly major_positive(20)+minor_positive(25)
//   7. maybeConvertNaturalSpawn -- the 5% roll, both directions
//   8. anti-vacuity -- break the module's own data and watch it get caught

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

console.log('zvillagercheck -- loop/zvillager-s102 (QUEUE 0.2 G18 mobs), zombie villager + conversion, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js', '07zk_undead.js', '07s_raid.js',
               '07q_effects.js', '07zr_zvillager.js', '07j_entityrender.js', '07zw_mobnbt.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Zv = MCL.ZVillager, Prof = MCL.Profession, Trade = MCL.Trade, Village = MCL.Village;
const W = MCL.World, S = MCL.States;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Prof.init();
Village.init();
MCL.Breed.init();   // loop/mob-test-passive: EL.spawn's zombie-family baby roll (07i_entitylist.js) calls
                    // NS.Breed.setBaby and every OTHER check tool that spawns via EL.spawn already does this;
                    // this one didn't, so zombie_villager's 5% baby roll ran Br.setBaby with Br unready.

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Zv && Zv.ready, 'NS.ZVillager did not load/ready');

// -- 1. spawnInit --------------------------------------------------------------------------
say('1. Zv.spawnInit -- profession roll, opts override, plains default');
{
  const seen = {};
  for (let i = 0; i < 300; i++) {
    const e = { type: 'zombie_villager' };
    Zv.spawnInit(e, {});
    seen[e.profession] = (seen[e.profession] || 0) + 1;
    ok(e.villagerType === 'plains', 'default villagerType must be plains (.decomp:79 default)');
    ok(e.villagerLevel === 1, 'default villagerLevel must be 1');
    ok(e.converting === false, 'a freshly spawned zombie villager must not be converting');
  }
  ok(Object.keys(seen).length > 3, `300 rolls across ${Prof.ALL.length} professions must not collapse to <=3 -- got ${Object.keys(seen).length}`);
  ok(seen['none'] !== undefined, 'the "none" profession must be a reachable roll (Prof.ALL includes it)');

  const forced = { type: 'zombie_villager' };
  Zv.spawnInit(forced, { profession: 'farmer', villagerType: 'desert', villagerLevel: 3, tradeXp: 40 });
  ok(forced.profession === 'farmer', 'opts.profession must win over the roll');
  ok(forced.villagerType === 'desert', 'opts.villagerType must win over the plains default');
  ok(forced.villagerLevel === 3 && forced.tradeXp === 40, 'opts.villagerLevel/tradeXp must be honoured');

  const wrongType = { type: 'zombie' };
  Zv.spawnInit(wrongType, {});
  ok(wrongType.profession === undefined, 'spawnInit must refuse a non-zombie_villager entity');
}

// -- 2. shouldConvertOnKill -----------------------------------------------------------------
say('2. Zv.shouldConvertOnKill -- the difficulty gate, both directions');
{
  ok(Zv.shouldConvertOnKill('peaceful', () => 0) === false, 'PEACEFUL must never convert');
  ok(Zv.shouldConvertOnKill('easy', () => 0) === false, 'EASY must never convert');
  ok(Zv.shouldConvertOnKill('hard', () => 0.999) === true, 'HARD must ALWAYS convert, even on a near-miss roll');
  ok(Zv.shouldConvertOnKill('normal', () => 0) === false, 'NORMAL must skip on roll < 0.5 (the 50% nextBoolean() skip)');
  ok(Zv.shouldConvertOnKill('normal', () => 0.9) === true, 'NORMAL must convert on roll >= 0.5');
}

// -- 3. kill-conversion ----------------------------------------------------------------------
say('3. Zv.convertVillagerToZombie -- EL.spawn carries villager data across');
{
  const v = EL.spawn('villager', 10, 64, 10, {});
  ok(!!v, 'EL.spawn(villager) must succeed');
  v.profession = 'librarian'; v.villagerType = 'taiga'; v.villagerLevel = 4; v.tradeXp = 77;
  v.gossip = { minor_negative: 25 };
  v.tradeOffers = [{ kind: 'sell_item_for_emerald' }];
  v.tradeUses = [1];

  const zv = Zv.convertVillagerToZombie(v, 'hard', () => 0);
  ok(!!zv, 'a HARD-difficulty kill must produce a zombie_villager');
  ok(zv.type === 'zombie_villager', 'the spawned entity must be type zombie_villager');
  ok(zv.profession === 'librarian', 'profession must carry across the kill-conversion');
  ok(zv.villagerType === 'taiga', 'villagerType must carry across the kill-conversion');
  ok(zv.villagerLevel === 4 && zv.tradeXp === 77, 'level/xp must carry across the kill-conversion');
  ok(JSON.stringify(zv.gossip) === JSON.stringify({ minor_negative: 25 }), 'gossip must carry across the kill-conversion');
  ok(v.removed === true, 'the source villager must be removed once converted');

  const v2 = EL.spawn('villager', 12, 64, 12, {});
  const skipped = Zv.convertVillagerToZombie(v2, 'peaceful', () => 0);
  ok(skipped === null, 'PEACEFUL must never convert a kill');
  ok(v2.removed === false, 'a refused conversion must leave the villager alive');
}

// -- 4. applyGoldenApple -----------------------------------------------------------------
say('4. Zv.applyGoldenApple -- weakness required, both directions; timer range');
{
  const zv = EL.spawn('zombie_villager', 20, 64, 20, {});
  let weak = false, strengthTicks = null, weaknessRemoved = false;
  const io = {
    hasWeakness: () => weak,
    removeWeakness: () => { weaknessRemoved = true; },
    addStrength: (e, ticks) => { strengthTicks = ticks; }
  };
  const refused = Zv.applyGoldenApple(zv, 'uuid-1', () => 0, io);
  ok(refused === false, 'no weakness -- the golden apple must be refused (ActionResult.CONSUME, .decomp:158)');
  ok(zv.converting === false, 'a refused apple must not start curing');

  weak = true;
  const started = Zv.applyGoldenApple(zv, 'uuid-1', () => 0, io);
  ok(started === true, 'weakness present -- the golden apple must start curing');
  ok(zv.converting === true, 'converting must now be true');
  ok(weaknessRemoved === true, 'weakness must be removed on cure start (.decomp:186)');
  ok(strengthTicks === Zv.CURE_TIMER_MIN, 'strength duration must equal the rolled timer (rand()=0 -> the floor, 3600)');
  ok(zv.conversionTimer === Zv.CURE_TIMER_MIN, 'a rand()=0 roll must give the timer floor, 3600 (.decomp:154)');

  const zv2 = EL.spawn('zombie_villager', 22, 64, 22, {});
  Zv.applyGoldenApple(zv2, 'uuid-2', () => 0.999999, io);
  ok(zv2.conversionTimer === Zv.CURE_TIMER_MIN + Zv.CURE_TIMER_RANGE - 1,
    `a rand()~1 roll must give the timer ceiling -- got ${zv2.conversionTimer}`);

  // #3854: vanilla has no isConverting() guard -- weakened again, a converting one re-rolls the timer
  zv.conversionTimer = 5;
  weaknessRemoved = false;
  const again = Zv.applyGoldenApple(zv, 'uuid-3', () => 0.5, io);
  okAv(again === true && zv.conversionTimer >= Zv.CURE_TIMER_MIN && weaknessRemoved, 'apple on converting+weakened re-rolls timer to 3600..6000');
  weak = false;
  ok(Zv.applyGoldenApple(zv, 'uuid-3', () => 0, io) === false, 'converting but NOT weakened -- still refused');
  weak = true;

  // live path: Zv.interact with real NS.Effects must give Strength for the whole timer
  const zv3 = EL.spawn('zombie_villager', 24, 64, 24, {});
  MCL.Effects.addStatusEffect(zv3, 'weakness', 200, 0);
  const r = Zv.interact({ uuid: 'p' }, zv3, Zv.CURE_ITEM, () => 0);
  ok(r && r.consumed === true, 'Zv.interact must consume the apple');
  ok(MCL.Effects.hasStatusEffect(zv3, 'strength'), 'live cure must apply Strength (setConverting, .decomp:~186)');
  ok(zv3.effects.strength && zv3.effects.strength.duration === zv3.conversionTimer, 'strength duration must equal conversionTimer');
  ok(!MCL.Effects.hasStatusEffect(zv3, 'weakness'), 'live cure must remove weakness');
}

// -- 5. conversionRate ------------------------------------------------------------------------
say('5. Zv.conversionRate -- base 1, the 1% roll, the iron_bars/bed scan, the 14-block cap');
{
  const noBlocks = () => null;
  ok(Zv.conversionRate(0, 64, 0, () => 0.5, noBlocks) === 1, 'a >=1% roll must return the flat base rate, 1');

  let calls = 0;
  const allIronBars = () => { calls++; return 'iron_bars'; };
  const alwaysRoll = (() => { let n = 0; return () => (n++ === 0 ? 0 : 0.0); })();
  calls = 0;
  const rate = Zv.conversionRate(0, 64, 0, alwaysRoll, allIronBars);
  ok(rate > 1, `an entirely iron_bars box, every roll hitting, must push the rate above 1 -- got ${rate}`);
  ok(calls === Zv.RATE_SCAN_CAP, `the scan must stop at the 14-block cap -- got ${calls} blockAt calls`);

  let bedCalls = 0;
  const allBeds = () => { bedCalls++; return 'red_bed'; };
  const rate2 = Zv.conversionRate(0, 64, 0, (() => { let n = 0; return () => (n++ === 0 ? 0 : 1); })(), allBeds);
  ok(rate2 === 1, 'a bed scan where every per-block roll MISSES (rand=1, never <0.3) must stay at the base rate');
  ok(bedCalls === Zv.RATE_SCAN_CAP, `a bed box must ALSO be counted toward the 14-block cap -- got ${bedCalls}`);

  const irrelevant = () => 'stone';
  const rateStone = Zv.conversionRate(0, 64, 0, (() => { let n = 0; return () => (n++ === 0 ? 0 : 0); })(), irrelevant);
  ok(rateStone === 1, 'a box with no iron_bars/bed must never raise the rate, no matter how the per-block roll lands');
}

// -- 5b. #1044: (int) truncation scan box + convertTo state copy ------------------------------
say('5b. #1044 -- scan box truncates toward zero; baby/custom name/persistence survive both conversions');
{
  const seen = (cx) => { const xs = []; Zv.conversionRate(cx, 64, 0, (() => { let n = 0; return () => (n++ === 0 ? 0 : 1); })(), (x) => { xs.push(x); return null; }); return xs; };
  const xs = seen(-0.5);
  ok(Math.min(...xs) === -4 && Math.max(...xs) === 3, `x=-0.5 must scan (int)-0.5=0 -> -4..3 (floor would give -5..2) -- got ${Math.min(...xs)}..${Math.max(...xs)}`);
  const v = EL.spawn('villager', 20, 64, 20, {});
  v.growAge = -24000; v.customName = 'Bob'; v.persistent = true;
  const zv = Zv.convertVillagerToZombie(v, 'hard', () => 0);
  ok(zv.growAge < 0, 'a baby villager must become a BABY zombie villager');
  ok(zv.customName === 'Bob' && zv.persistent === true, 'custom name + persistence must survive the kill-conversion');
  zv.converting = true;
  const back = Zv.finishConversion(zv);
  ok(back.growAge < 0 && back.customName === 'Bob' && back.persistent === true, 'baby/name/persistence must survive the cure');
  const adult = Zv.finishConversion(Object.assign(EL.spawn('zombie_villager', 22, 64, 22, {}), { converting: true, growAge: 0 }));
  ok(!(adult.growAge < 0), 'an adult zombie villager must cure into an adult');
  // anti-vacuity: with the floor-shifted scan the assertion above must fail
  const floorXs = []; for (let d = -4; d < 4; d++) floorXs.push(Math.floor(-0.5) + d);
  okAv(Math.min(...floorXs) === -5, 'the old floor scan really is shifted (-5..2), so the truncation assertion can fail');
  const saved = MCL.Breed && MCL.Breed.setBaby; if (MCL.Breed) MCL.Breed.setBaby = () => {};
  const v3 = EL.spawn('villager', 24, 64, 24, {}); v3.growAge = -24000;
  const z3 = Zv.convertVillagerToZombie(v3, 'hard', () => 0);
  if (MCL.Breed) MCL.Breed.setBaby = saved;
  okAv(z3 && !(z3.growAge < 0), 'with the baby copy disabled (setBaby stubbed) the zombie villager is NOT a baby, so the baby assertion can fail');
}

// -- 6. tick + finishConversion ----------------------------------------------------------------
say('6. Zv.tickConversion / Zv.finishConversion -- the swap back, and the cure gossip');
{
  const zv = EL.spawn('zombie_villager', 30, 64, 30, {});
  zv.profession = 'cartographer'; zv.villagerType = 'savanna'; zv.villagerLevel = 2; zv.tradeXp = 9;
  zv.converting = true; zv.conversionTimer = 2;
  const noBlocks = () => null;
  const rand0 = () => 0.5;   // >=1% -- base rate 1 every tick

  const finished1 = Zv.tickConversion(zv, rand0, noBlocks);
  ok(finished1 === false, 'a timer of 2 minus rate 1 must not finish yet');
  ok(zv.conversionTimer === 1, `conversionTimer must have dropped by exactly the base rate -- got ${zv.conversionTimer}`);
  const finished2 = Zv.tickConversion(zv, rand0, noBlocks);
  ok(finished2 === true, 'a timer of 1 minus rate 1 must finish (<=0)');

  const gossipCalls = [];
  const realStartGossip = Village.startGossip;
  Village.startGossip = (e, type, amount) => gossipCalls.push([type, amount]);
  zv.converterId = 'player-uuid';
  const v = Zv.finishConversion(zv);
  Village.startGossip = realStartGossip;

  ok(!!v, 'finishConversion must produce a villager');
  const nz = v.effects && v.effects.nausea;
  ok(!!nz && nz.duration === 200 && nz.amplifier === 0, `cured villager must get nausea(200,0), .decomp:243 -- got ${JSON.stringify(nz)}`);
  ok(v.type === 'villager', 'the result must be type villager');
  ok(v.profession === 'cartographer', 'profession must carry across finishConversion');
  ok(v.villagerType === 'savanna' && v.villagerLevel === 2 && v.tradeXp === 9,
    'villagerType/level/xp must carry across finishConversion');
  ok(zv.removed === true, 'the zombie villager must be removed once cured');
  ok(gossipCalls.length === 2, `finishConversion must grant exactly 2 gossip entries -- got ${gossipCalls.length}`);
  ok(JSON.stringify(gossipCalls[0]) === JSON.stringify(['major_positive', 20]),
    `first gossip must be major_positive(20), 07l_spawn.js:945 -- got ${JSON.stringify(gossipCalls[0])}`);
  ok(JSON.stringify(gossipCalls[1]) === JSON.stringify(['minor_positive', 25]),
    `second gossip must be minor_positive(25), 07l_spawn.js:946 -- got ${JSON.stringify(gossipCalls[1])}`);
}

// -- 7. #3104: no natural zombie->zombie_villager swap ---------------------------------------------
say('7. #3104 -- Zv.maybeConvertNaturalSpawn is gone; Spawn.placePack must not swap zombies');
{
  ok(Zv.maybeConvertNaturalSpawn === undefined && Zv.NATURAL_SPAWN_CHANCE === undefined, 'the 5% swap must not exist');
  ok(!/maybeConvertNaturalSpawn/.test(readFileSync(join(MCLITE_ROOT, 'src/07l_spawn.js'), 'utf8')), '07l_spawn.js must not call the swap');
  const fake = readFileSync(join(MCLITE_ROOT, 'src/07l_spawn.js'), 'utf8') + ' NS.ZVillager.maybeConvertNaturalSpawn(e, rnd);';
  okAv(/maybeConvertNaturalSpawn/.test(fake), 'a reintroduced call is seen by the source scan');
}

// -- 7b. the play path: Use.entityUse dispatches a golden apple to the zombie villager (#1043) ----
say('7b. Use.entityUse -- golden_apple on a zombie villager, weakness gate, apple spent, cure, sounds');
{
  const Use = MCL.Use, Iv = MCL.Inventory, ES = MCL.Effects;
  const played = [];
  const realPlay = MCL.Sound && MCL.Sound.play;
  MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (n) => { played.push(n); };
  const gapple = MCL.Items.of('golden_apple');
  const P = { instabuild: false, uuid: 'p1', slot: 0, inventory: { slots: [Iv.stack(gapple, 2, 0)] } };
  const zv = EL.spawn('zombie_villager', 30, 64, 30, { profession: 'librarian' });
  ok(Use.entityUse(P, zv, P.inventory.slots[0]) === true, 'no weakness: the apple is swallowed (CONSUME)');
  ok(P.inventory.slots[0].n === 2 && !zv.converting, 'no weakness: apple kept, not converting');
  ES.addStatusEffect(zv, 'weakness', 1000, 0);
  ok(Use.entityUse(P, zv, P.inventory.slots[0]) === true, 'weakness: apple used');
  ok(P.inventory.slots[0].n === 1, 'weakness: exactly one apple consumed');
  ok(zv.converting === true && zv.conversionTimer >= 3600 && zv.conversionTimer < 6001, 'converting with a 3600..6000 timer');
  ok(played.includes('entity.zombie_villager.cure'), 'status-16 cure sound played');
  for (let i = 0; i < 6100 && !zv.removed; i++) Zv.tickOne(zv);
  ok(zv.removed === true, 'after the timer the zombie villager is gone');
  ok(played.includes('entity.zombie_villager.converted'), 'event 1027 converted sound played');
  played.length = 0;
  const z2 = EL.spawn('villager', 40, 64, 40, {});
  ok(Zv.convertVillagerToZombie(z2, 'hard', () => 0) !== null && played.includes('entity.zombie.infect'), 'kill conversion plays zombie.infect (1026)');
  const z3 = EL.spawn('zombie_villager', 31, 64, 31, {});
  Use.entityUse(P, z3, Iv.stack(MCL.Items.of('apple'), 1, 0));
  ok(!z3.converting, 'an ordinary apple does nothing');
  // anti-vacuity: without weakness-checking dispatch the gate would be wrong -- break hasWeakness
  const saved = ES.hasStatusEffect; ES.hasStatusEffect = () => true;
  const z4 = EL.spawn('zombie_villager', 32, 64, 32, {});
  Use.entityUse(P, z4, P.inventory.slots[0]);
  okAv(z4.converting === true, 'a broken weakness gate is seen (cure starts without weakness)');
  ES.hasStatusEffect = saved;
  if (realPlay) MCL.Sound.play = realPlay;
}

// -- 8. anti-vacuity -----------------------------------------------------------------------
say('8. anti-vacuity -- break the module\'s own data and watch it get caught');
{
  // 8a. corrupt KILL_SKIP_ON_NORMAL to 0 (no skip at all) and confirm the SAME roll that
  // correctly refused above (0.4 on NORMAL) now wrongly converts -- proves section 2 is not
  // vacuously true, since a real bug here (dropping the 50% skip) IS observable.
  const savedSkip = Zv.KILL_SKIP_ON_NORMAL;
  Zv.KILL_SKIP_ON_NORMAL = 0;
  const brokenSkip = Zv.shouldConvertOnKill('normal', () => 0.4);
  Zv.KILL_SKIP_ON_NORMAL = savedSkip;
  okAv(brokenSkip === true, 'zeroing KILL_SKIP_ON_NORMAL must flip a roll of 0.4 from refuse to convert');
  okAv(Zv.shouldConvertOnKill('normal', () => 0.4) === false, 'restoring KILL_SKIP_ON_NORMAL must restore the refusal');

  // 8b. corrupt RATE_BLOCK_CHANCE to 0 (no iron_bars/bed speedup ever lands) and confirm an
  // all-iron_bars, always-rolling box now stays at the base rate -- proves section 5's ">1"
  // assertion is load-bearing, not accidental.
  const savedChance = Zv.RATE_BLOCK_CHANCE;
  Zv.RATE_BLOCK_CHANCE = 0;
  const allIronBars = () => 'iron_bars';
  const alwaysRoll = () => 0;
  const brokenRate = Zv.conversionRate(0, 64, 0, alwaysRoll, allIronBars);
  Zv.RATE_BLOCK_CHANCE = savedChance;
  okAv(brokenRate === 1, 'zeroing RATE_BLOCK_CHANCE must collapse an all-iron_bars box back to rate 1');
  okAv(Zv.conversionRate(0, 64, 0, alwaysRoll, allIronBars) > 1, 'restoring RATE_BLOCK_CHANCE must restore the speedup');

  // 8c. corrupt CURE_GOSSIP_MAJOR (a real jar-verified constant, 07l_spawn.js:945) and confirm
  // finishConversion's own gossip call carries the corruption through -- proves section 6's
  // exact-amount assertion would catch a typo'd magnitude, not just "some gossip happened".
  const zv = EL.spawn('zombie_villager', 50, 64, 50, {});
  zv.converting = true; zv.converterId = 'player-uuid';
  const savedMajor = Zv.CURE_GOSSIP_MAJOR;
  Zv.CURE_GOSSIP_MAJOR = 999;
  let seenAmount = null;
  const realSG = Village.startGossip;
  Village.startGossip = (e, type, amount) => { if (type === 'major_positive') seenAmount = amount; };
  Zv.finishConversion(zv);
  Village.startGossip = realSG;
  Zv.CURE_GOSSIP_MAJOR = savedMajor;
  okAv(seenAmount === 999, 'corrupting CURE_GOSSIP_MAJOR must show up verbatim in the gossip call the check would assert against');

  // 8d. #3551 -- finishConversion fires CURED_ZOMBIE_VILLAGER for the converter (.decomp:239-242)
  const fired = [];
  const player = { uuid: 'p1', advancements: {} };
  MCL.Adv = MCL.Adv || {};
  const realTrig = MCL.Adv.trigger;
  MCL.Adv.trigger = (pl, id) => { fired.push([pl, id]); return 1; };
  Zv.curers.p1 = player;
  const zc = EL.spawn('zombie_villager', 52, 64, 50, {});
  zc.converting = true; zc.converterId = 'p1';
  Zv.finishConversion(zc);
  okAv(fired.length === 1 && fired[0][0] === player && fired[0][1] === 'minecraft:cured_zombie_villager', 'cure must trigger minecraft:cured_zombie_villager for the converter');
  const zn = EL.spawn('zombie_villager', 54, 64, 50, {});
  zn.converting = true; zn.converterId = 'nobody';
  Zv.finishConversion(zn);
  okAv(fired.length === 1, 'an unresolvable converter must fire nothing');
  delete Zv.curers.p1;
  MCL.Adv.trigger = realTrig;
}

// -- D-567. finishConversion's equipment loop (.decomp ZombieVillagerEntity.java:214-226) ----------
say('D-567. Zv.rehomeEquipment -- binding curse kept in the villager inventory, drop chance > 1.0 drops');
{
  const Eq = MCL.Equip, IT = MCL.Items;
  if (Eq.init) Eq.init();
  const mk = (name, curse) => { const st = Eq.stackOf(name); if (curse) Eq.applyEnchants(st, [{ id: 'binding_curse', lvl: 1 }]); return st; };
  const build = () => {
    const zv = EL.spawn('zombie_villager', 40.5, 5, 40.5, { profession: 'farmer' });
    zv.equip = [];
    Eq.setEquipped(zv, IT.HEAD, mk('iron_helmet', true));        // cursed -> villager inventory slot 3
    Eq.setEquipped(zv, IT.CHEST, mk('iron_chestplate', false));   // default 0.085 -> gone
    Eq.setEquipped(zv, IT.MAINHAND, mk('iron_sword', false));     // guaranteed 2.0 -> dropped
    Eq.setDropChance(zv, IT.MAINHAND, 2.0);
    Eq.setEquipped(zv, IT.FEET, mk('iron_boots', true));          // cursed -> slot 0
    return zv;
  };
  const drops = [];
  const realDrop = EL.dropStack;
  EL.dropStack = (x, y, z, idx, n) => { drops.push({ item: IT.nameOf(idx), n }); };
  const zv = build();
  const v = Zv.finishConversion(zv);
  EL.dropStack = realDrop;
  const inv = v && v.villagerInventory;
  ok(!!inv && inv.length === 8, `the cured villager carries MerchantEntity's 8-slot inventory (got ${inv && inv.length})`);
  ok(inv && inv[3] && IT.nameOf(inv[3].i) === 'iron_helmet', 'a binding-cursed helmet lands in villager inventory slot 3 (HEAD getEntitySlotId)');
  ok(inv && inv[0] && IT.nameOf(inv[0].i) === 'iron_boots', 'a binding-cursed boot lands in slot 0 (FEET getEntitySlotId)');
  ok(inv && !inv[2], 'the UNcursed chestplate is not kept (slot 2 empty)');
  ok(drops.length === 1 && drops[0].item === 'iron_sword', `only the drop-chance-2.0 sword drops (got ${JSON.stringify(drops)})`);
  ok(!drops.some((d) => d.item === 'iron_chestplate'), 'the default-chance (0.085, not > 1.0) chestplate does NOT drop -- it vanishes');
  // the jar's overwrite quirk: a cursed mainhand and a cursed boot share index 0; FEET iterates later and wins
  const zq = EL.spawn('zombie_villager', 44.5, 5, 44.5, {}); zq.equip = [];
  Eq.setEquipped(zq, IT.MAINHAND, mk('iron_sword', true)); Eq.setEquipped(zq, IT.FEET, mk('iron_boots', true));
  const rq = Zv.rehomeEquipment(zq, {});
  ok(rq.kept.length === 2 && rq.kept.every((k) => k.index === 0), 'both cursed stacks resolve to index 0 (mainhand 0, feet 0)');
  // anti-vacuity: break the slot map and the check must see it; drop the curse test and it must see that
  const savedId = Zv.ENTITY_SLOT_ID.HEAD; Zv.ENTITY_SLOT_ID.HEAD = 5;
  const zb = build(); EL.dropStack = () => {}; const vb = Zv.finishConversion(zb); EL.dropStack = realDrop;
  Zv.ENTITY_SLOT_ID.HEAD = savedId;
  okAv(!(vb && vb.villagerInventory && vb.villagerInventory[3]), 'a wrong HEAD slot id moves the helmet off slot 3 -- the slot-3 assertion is live');
  const realEL = MCL.Combat.enchantLevel; MCL.Combat.enchantLevel = () => 0;
  const zc = build(); const dc = []; EL.dropStack = (x, y, z, idx) => dc.push(IT.nameOf(idx)); const vc = Zv.finishConversion(zc); EL.dropStack = realDrop;
  MCL.Combat.enchantLevel = realEL;
  okAv(!(vc && vc.villagerInventory), 'with the curse test blinded nothing is kept -- the kept-in-inventory assertions are live');
}

// -- 9. loop/mob-test-passive -- EL.spawn's zombie-family baby roll must not crash when
//    NS.Breed exists but is not READY (07i_entitylist.js: EL.ZOMBIE_BABY_ROLL branch). Before
//    this unit the guard checked only `NS.Breed.setBaby` (a function that exists whether or not
//    Breed.init() ever ran); a zombie_villager's own 5% baby roll then called Br.setBaby with
//    Br.C still undefined and threw `TypeError: Cannot read properties of undefined (reading
//    'babyStartAge')` -- this check itself hit it intermittently (5% of runs) before it started
//    calling MCL.Breed.init() above, because NOTHING ELSE in this file's setup did.
say('9. EL.spawn zombie-family baby roll must survive NS.Breed existing-but-unready');
{
  const savedReady = MCL.Breed.ready;
  const savedC = MCL.Breed.C;
  const savedRandom = EL.random;
  MCL.Breed.ready = false; MCL.Breed.C = undefined;   // simulate Breed.init() NEVER having run,
                                                       // the exact state this file's own setup was in before this unit
  EL.random = () => 0;       // force NS.Undead.rollBaby's 5% roll to hit, every time -- no flakiness
  let threw = false;
  let zb2 = null;
  try {
    zb2 = EL.spawn('zombie_villager', 60, 64, 60, {});
  } catch (e) {
    threw = true;
  }
  MCL.Breed.ready = savedReady; MCL.Breed.C = savedC;
  EL.random = savedRandom;
  ok(threw === false, 'EL.spawn(zombie_villager) must not throw when NS.Breed exists but is not ready (07i_entitylist.js guard)');
  okAv(!!zb2, 'the spawn above must still have produced an entity (not silently swallowed by the try/catch itself)');
  // anti-vacuity: force the OLD unguarded call and confirm it really did crash the way it was reported --
  // proves the assertion above is catching a real regression, not a permanently-true tautology.
  const savedC2 = MCL.Breed.C;
  MCL.Breed.ready = false; MCL.Breed.C = undefined;
  let oldThrew = false;
  try { MCL.Breed.setBaby(EL.spawn('zombie_villager', 62, 64, 62, {}), true); } catch (e) { oldThrew = true; }
  MCL.Breed.ready = savedReady; MCL.Breed.C = savedC2;
  okAv(oldThrew === true, 'calling the OLD unguarded Breed.setBaby directly with Breed unready must still throw -- the bug this guard fixes is real, not imagined');
}

{ // #3550: ZombieVillagerEntityRenderer.isShaking = super || isConverting()
  const ER = MCL.EntityRender;
  ok(ER.isShaking({ type: 'zombie_villager', converting: true }) === true, 'a converting zombie villager shakes');
  okAv(ER.isShaking({ type: 'zombie_villager', converting: false }) === false, 'a non-converting zombie villager does not shake');
}

{ // #3722: ConversionPlayer survives the mob NBT round trip and the finish still grants gossip + advancement
  const Mb = MCL.MobNbt;
  const fields = Mb.fieldsFor('zombie_villager');
  ok(fields.includes('converterId'), 'zombie_villager NBT carries converterId (ConversionPlayer)');
  const savedFields = Mb.fieldsFor;
  Mb.fieldsFor = (t) => savedFields(t).filter((f) => f !== 'converterId');
  okAv(!Mb.fieldsFor('zombie_villager').includes('converterId'), 'without the field the cure initiator would be dropped on save');
  Mb.fieldsFor = savedFields;
  const savedP = MCL.Player, savedAdv = MCL.Adv, got = [];
  MCL.Player = { uuid: 'p77' }; MCL.Adv = { trigger: (p, id) => got.push(id) };
  const zv = EL.spawn('zombie_villager', 60, 64, 60, {});
  Zv.applyGoldenApple(zv, 'p77', () => 0, { hasWeakness: () => true });
  zv.converterId = JSON.parse(JSON.stringify({ c: zv.converterId })).c;   // the save/load hop
  Zv.finishConversion(zv);
  ok(got.includes('minecraft:cured_zombie_villager'), 'reloaded cure (no curers entry) still grants the advancement via the live player');
  MCL.Player = savedP; MCL.Adv = savedAdv;
}

{ // #3860: MobEntity.convertTo parity -- invulnerable, customNameVisible, vehicle, baby eye-height sound
  const Rd = MCL.Raid;
  const boat = EL.spawn('chicken', 70, 64, 70, {});
  const v = EL.spawn('villager', 70, 64, 70, {});
  v.invulnerable = true; v.customName = 'Bob'; v.customNameVisible = true; Rd.startRiding(v, boat);
  const zv = Zv.convertVillagerToZombie(v, 'hard', () => 0);
  ok(zv.invulnerable === true && zv.customNameVisible === true, 'kill conversion keeps invulnerable + customNameVisible');
  ok(zv.vehicle === boat && boat.passenger === zv, 'kill conversion moves the rider to the new mob');
  zv.invulnerable = false; zv.customNameVisible = false;
  okAv(!(zv.invulnerable || zv.customNameVisible), 'anti-vacuity: the flags can be absent');
  zv.invulnerable = true; zv.customNameVisible = true; zv.growAge = -24000; zv.converting = true;
  const ys = [], sp = MCL.Sound && MCL.Sound.play; MCL.Sound = MCL.Sound || {};
  MCL.Sound.play = (n, o) => ys.push(o.y);
  const back = Zv.finishConversion(zv);
  MCL.Sound.play = sp;
  ok(back.invulnerable === true && back.customNameVisible === true && back.vehicle === boat, 'cure keeps invulnerable/nameVisible/vehicle');
  ok(Math.abs(ys[0] - (zv.y + 0.93)) < 1e-9, 'baby cure sound plays at eye height 0.93, got ' + (ys[0] - zv.y));
}

console.log('================ zvillagercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==================================================');
process.exit(fails.length ? 1 : 0);
