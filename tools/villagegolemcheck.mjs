#!/usr/bin/env node
// villagegolemcheck.mjs — QUEUE row 0.2 remainder: the iron golem's angry-player TARGET half,
// TrackIronGolemTargetGoal (DefendVillageTargetGoal) + the minimal villager reputation/gossip
// substrate it needs, UniversalAngerGoal's re-acquire chain, and the VILLAGE SPAWN TRIGGER
// (VillagerEntity.summonGolem/canSummonGolem, javap'd — see 07l_spawn.js's own `Village`
// module header for every class/method name and every simplification, named not guessed).
//
//   node tools/villagegolemcheck.mjs [--verbose]
//
// ⚠ SAME SHAPE AS aicheck.mjs's OWN §7 — every section here drives the REAL EL.spawn/EL.tick
// loop and the real Cb.attack/Trade.attempt call sites (not a synthetic fixture with hand-set
// fields), because that JOIN (a real hit reaching a goal through Cb.notifyHurt) is exactly what
// D-391 found empty once already; this unit adds new hooks in the SAME two call sites
// (Cb.notifyHurt, Trade.attempt) and a new one (EL.tickMob -> Village.tick), so the same class
// of gap is worth re-proving here rather than assumed closed by analogy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

console.log('villagegolemcheck — QUEUE row 0.2 remainder: golem angry-player target, village gossip substrate, spawn trigger');

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
               '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js', '07p_trade.js',
               '14c_raycast.js', '07q_effects.js', '07y_equip.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
M.EntityList.init();
M.Hand.init();
M.Combat.init();
M.Ai.init();
M.Village.init();
ok(M.Village.ready, 'Village module reports ready');

const EL = M.EntityList, Ai = M.Ai, Cb = M.Combat, W = M.World, CH = M.CH, Village = M.Village;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  M.Behave.init(W);
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
    walkDist: 0, walkDistO: 0, speed: 0.1
  }, over || {});
}

// ═══ 1. Village.getReputation — the gossip-type sum, javap'd off VillageGossipType's <clinit> ═
console.log('\n 1. Village.getReputation sums every gossip type by its own multiplier (VillageGossipType, javap\'d)');
{
  const v = {};
  Village.startGossip(v, 'major_negative', 25);
  ok(Village.getReputation(v) === -125, `major_negative(25) * multiplier(-5) = -125, got ${Village.getReputation(v)}`);
  Village.startGossip(v, 'trading', 2);
  ok(Village.getReputation(v) === -123, `+trading(2) * multiplier(1) = -123, got ${Village.getReputation(v)}`);
  // clamp: a gossip type never exceeds its own maxValue (major_negative's is 100)
  const v2 = {};
  Village.startGossip(v2, 'major_negative', 1000);
  ok(v2.gossip.major_negative === 100, `major_negative clamps at its own maxValue (100), got ${v2.gossip.major_negative}`);
  // ANTI-VACUITY: an unrecognised type is refused rather than silently added
  const v3 = {};
  Village.startGossip(v3, 'not_a_real_type', 999);
  okAv(!v3.gossip, 'an unrecognised gossip type is refused outright — startGossip is reading VillageGossipType\'s own table, not accepting anything handed to it');
}

// ═══ 2. Village.decayGossip — VillagerGossips.Reputation.decay, once per real day (24000 ticks) ═
console.log('\n 2. Village.decayGossip ages every held type down by its own decay, once per 24000-tick day');
{
  const v = {};
  Village.startGossip(v, 'minor_negative', 25);   // decay=20
  Village.decayGossip(v, 0);           // first call only RECORDS lastDecay — VillagerEntity.decayGossip's own `if (lastGossipDecayTime==0)` branch
  ok(v.gossip.minor_negative === 25, 'the first decayGossip call does not yet decay anything — it only starts the clock');
  Village.decayGossip(v, 12000);        // under the 24000-tick gap
  ok(v.gossip.minor_negative === 25, 'and nothing decays before a full day has passed');
  Village.decayGossip(v, 24000);
  ok(v.gossip.minor_negative === 5, `a full day later, minor_negative(25) - decay(20) = 5, got ${v.gossip.minor_negative}`);
  Village.decayGossip(v, 48000);
  ok(!v.gossip.minor_negative, 'and a second day drops it below the 2-floor, so it is removed entirely — Reputation.decay\'s own obsolete rule');
}

// ═══ 3. Village.onHurt — VillagerEntity.setAttacker -> handleInteraction(VILLAGER_HURT,...) ═══
console.log('\n 3. a real Cb.attack on a villager files villager_hurt gossip against the LIVE attacker');
freshWorld();
plate(15);
{
  const P = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  M.Player = P;
  const vil = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  ok(!!vil, 'a villager could be spawned');
  const res = Cb.attack(P, vil);
  ok(!!(res && res.hit), 'the real Cb.attack landed on the villager');
  ok(vil.gossip && vil.gossip.minor_negative === 25, `a real landed hit filed minor_negative(25) gossip against the attacker, got ${JSON.stringify(vil.gossip)}`);
  EL.clear();

  // ANTI-VACUITY: silence Cb.notifyHurt, and the same real hit files no gossip at all
  const savedNotify = Cb.notifyHurt;
  Cb.notifyHurt = function () {};
  const P2 = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  M.Player = P2;
  const vil2 = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  Cb.attack(P2, vil2);
  okAv(!vil2.gossip, 'with Cb.notifyHurt silenced, the same real hit lands but no gossip is ever filed — proving §3 above is the hook firing, not luck');
  Cb.notifyHurt = savedNotify;
  EL.clear();
}

// ═══ 4. villager_killed — a lethal hit broadcasts major_negative to nearby OTHER villagers ════
console.log('\n 4. killing a villager broadcasts villager_killed gossip to every OTHER nearby villager');
freshWorld();
plate(15);
{
  const P = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1, instabuild: true });
  M.Player = P;
  const victim = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  const witness = EL.spawn('villager', 3, PLAT_Y + 1, 0);
  const farAway = EL.spawn('villager', 40, PLAT_Y + 1, 40);   // outside the (10,10,10) box — must NOT hear about it
  victim.health = 0.1;   // Cb.attack's own unarmed-cooldown-scaled damage is well under 1
  Cb.attack(P, victim);
  ok(victim.dead === true, 'the villager actually died from a real hit');
  ok(witness.gossip && witness.gossip.major_negative === 25, `the nearby witness villager gossips major_negative(25) about the killer, got ${JSON.stringify(witness.gossip)}`);
  ok(!farAway.gossip, 'and a villager outside the box hears nothing — the broadcast has a real radius, not every villager in the world');
  ok(!victim.gossip || !victim.gossip.major_negative, 'the victim itself does not gossip about its own death (the loop skips it, matching notifyDeath\'s own observer set which cannot include the dead villager)');
  EL.clear();
}

// ═══ 5. Trade.attempt files trading(2) gossip — VillagerEntity.onInteractionWith(TRADE,...) ═══
console.log('\n 5. a completed Trade.attempt files trading gossip for the villager');
freshWorld();
plate(15);
{
  const wheatId = M.Items.of('wheat');
  const vil = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  // a hand-built offer, the same shape professioncheck/tradecheck already own the REAL roll
  // of — this section's own question is only "does a completed trade file gossip", not which
  // offers a given profession gets.
  vil.tradeProfession = vil.profession;   // Trade.ensure's own reset gate — see 07p_trade.js
  vil.tradeOffers = [{ kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 12 }];
  vil.tradeUses = [0];
  const P = { inventory: M.Inventory.create(), instabuild: false };
  M.Player = P;
  M.Inventory.setItem(P.inventory, 0, { i: wheatId, n: 20 });
  const res = M.Trade.attempt(vil, 0, P);
  ok(!!(res && res.ok), 'the real Trade.attempt succeeded');
  ok(vil.gossip && vil.gossip.trading === 2, `a real completed trade filed trading(2) gossip, got ${JSON.stringify(vil.gossip)}`);
  EL.clear();

  // ANTI-VACUITY: an offer that never completes (not enough emerald owed back, or refused for
  // any other Trade.attempt reason) files no gossip at all
  const vil2 = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  vil2.tradeProfession = vil2.profession;
  vil2.tradeOffers = [{ kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 12 }];
  vil2.tradeUses = [0];
  const P2 = { inventory: M.Inventory.create(), instabuild: false };   // no wheat at all
  const res2 = M.Trade.attempt(vil2, 0, P2);
  okAv(!(res2 && res2.ok) && !vil2.gossip, 'a trade that Trade.attempt itself refuses (not enough wheat) files no gossip — proving §5 above is driven by a REAL success, not called unconditionally');
  EL.clear();
}
// ═══ 6. TrackIronGolemTargetGoal — a villager's own reputation, not proximity, drives the target
console.log('\n 6. TrackIronGolemTargetGoal targets the player once a nearby villager\'s reputation is <= -100');
freshWorld();
plate(15);
{
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  const vil = EL.spawn('villager', 1, PLAT_Y + 1, 0);
  Village.startGossip(vil, 'major_negative', 100);   // -500, well past -100
  const golem = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  EL.tick();
  ok(golem.target === M.Player, `the golem targeted the live player off the villager's own reputation alone (no hit landed on the golem at all), reputation was ${Village.getReputation(vil)}`);
  EL.clear();

  // ANTI-VACUITY: the SAME villager, with reputation just short of -100, is not enough
  M.Player = mkPlayer({ x: 2, y: PLAT_Y + 1, z: 0 });
  const vil2 = EL.spawn('villager', 1, PLAT_Y + 1, 0);
  Village.startGossip(vil2, 'minor_negative', 90);   // -90, still short of -100
  const golem2 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(golem2.target !== M.Player, `reputation ${Village.getReputation(vil2)} (short of the -100 literal) does not trigger TrackIronGolemTargetGoal — proving §6 above reads the -100 threshold, not just "any negative gossip"`);
  EL.clear();
}

// ═══ 6b. TrackIronGolemTargetGoal — the PLAYER must be near and attackable (#736)
console.log('\n 6b. a far player, or a creative one, is not targeted despite a -100 villager beside the golem');
freshWorld();
plate(15);
{
  const setup = (over) => {
    M.Player = mkPlayer(Object.assign({ x: 2, y: PLAT_Y + 1, z: 0 }, over));
    const vil = EL.spawn('villager', 1, PLAT_Y + 1, 0);
    Village.startGossip(vil, 'major_negative', 100);
    const golem = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
    for (let t = 0; t < 5; t++) EL.tick();
    return golem;
  };
  const g0 = setup({});
  okAv(g0.target === M.Player, 'control: a near survival player is targeted');
  EL.clear();
  const g1 = setup({ x: 200 });
  okAv(g1.target !== M.Player, 'a player 200 blocks away is not targeted');
  EL.clear();
  const g2 = setup({ invulnerableGamemode: true });
  okAv(g2.target !== M.Player, 'a creative (invulnerable) player is not targeted');
  EL.clear();
}

// ═══ 7. UniversalAngerGoal + AngryPlayerTargetGoal — the re-acquire chain, javap'd off both ═══
console.log('\n 7. UniversalAngerGoal resets to universal anger, then AngryPlayerTargetGoal re-acquires the player');
freshWorld();
plate(15);
{
  const rule = ((M.DATA.gameRules = M.DATA.gameRules || {}).universalAnger = { t: 'b', d: 'false' });
  {   // #4571: default universalAnger=false -> UniversalAngerGoal never starts (GameRules.field_25402)
    const Pd = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
    M.Player = Pd;
    const g0 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
    Cb.attack(Pd, g0);
    const ug = g0.ai.entries.find((en) => en.goal.constructor === (M.Ai.UniversalAngerGoal.__orig || M.Ai.UniversalAngerGoal)).goal;
    ok(rule.d === 'false' && !ug.canUse(), 'with the default universalAnger=false UniversalAngerGoal.canUse() is false after a player hit (#4571)');
    rule.d = 'true';
    okAv(ug.canUse(), 'anti-vacuity: with universalAnger=true the same hit makes canUse() true');
    rule.d = 'false';
    EL.clear();
  }
  rule.d = 'true';   // the chain below is the rule-ON behaviour
  const P = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  M.Player = P;
  const golem = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  Cb.attack(P, golem);
  EL.tick();   // HurtByTargetGoal sets target+angerTime, THEN UniversalAngerGoal (flags=0, same tick) resets it
  ok(golem.angerTime > 0, 'the anger timer is running after one real tick');
  ok(golem.angryAt === null || golem.angryAt === undefined, 'and angryAt is null — UniversalAngerGoal.universallyAnger() actually ran and cleared it, matching the jar\'s own stopAnger()+chooseRandomAngerTime() shape');
  for (let i = 0; i < 200 && golem.target !== P; i++) EL.tick();   // AngryPlayerTargetGoal (priority 3) re-acquires (1/5 roll, #3677)
  ok(golem.target === P, 'and the golem re-acquired the live player one tick later — AngryPlayerTargetGoal\'s own re-acquire half is real, not dead code');
  EL.clear();

  // ANTI-VACUITY: outside the golem's own follow range (16 blocks), no re-acquire happens
  const P2 = mkPlayer({ x: 0, y: PLAT_Y + 1, z: 1 });
  M.Player = P2;
  const golem2 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  Cb.attack(P2, golem2);
  EL.tick();
  P2.x = 200;   // teleport far outside follow range before the re-acquire tick
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(golem2.target !== P2, 'once the angry player is moved 200 blocks away (outside the 16-block follow range), the golem does NOT re-acquire it — proving §7 above reads the range, not just "angerTime>0 exists somewhere"');
  EL.clear();
  rule.d = 'false';
}

// ═══ 8. the hostile-mob half of TARGET priority 3 excludes Creeper (bin.j, javap'd) ═══════════
console.log('\n 8. the golem\'s own hostile-mob targeting excludes Creeper specifically');
freshWorld();
plate(15);
{
  M.Spawn = { categoryOf: (t) => (t === 'zombie' || t === 'creeper') ? 'monster' : null };
  const creeper = EL.spawn('creeper', 3, PLAT_Y + 1, 0);
  const golem = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  for (let t = 0; t < 5; t++) EL.tick();
  okAv(golem.target !== creeper, 'a creeper, even though Spawn.categoryOf calls it \'monster\' the same as a zombie, is never targeted — bin.j\'s own !(instanceof CreeperEntity) filter is real');
  EL.clear();

  const zom = EL.spawn('zombie', 3, PLAT_Y + 1, 0);
  const golem2 = EL.spawn('iron_golem', 0, PLAT_Y + 1, 0);
  for (let i = 0; i < 200 && golem2.target !== zom; i++) EL.tick();   // NearestAttackableTargetGoal reciprocalChance roll (#3677)
  ok(golem2.target === zom, 'and the SAME candidate list still targets an actual zombie — the exclusion is Creeper-specific, not "no monster targeting at all"');
  EL.clear();
  delete M.Spawn;
}

// ═══ 9. the village spawn trigger — VillagerEntity.summonGolem/canSummonGolem, javap'd ═══════
console.log('\n 9. five eligible villagers in range spawn an iron golem, and the cooldown blocks an immediate second one');
freshWorld();
plate(15);
{
  const vs = [];
  for (let i = 0; i < 5; i++) vs.push(EL.spawn('villager', i, PLAT_Y + 1, 0));
  const before = EL.list.filter(e => e.type === 'iron_golem').length;
  ok(before === 0, 'no golem exists yet');
  M.Sky = { dayTime: 0 };
  // loop/sleep-s104: Village.canSummonGolem now also gates on Village.hasRecentlySlept
  // (e.vbLastSlept, 07zv_villagerbrain.js) -- a villager that has slept "just now" is eligible,
  // matching VillagerEntity.hasRecentlySlept's own `now - LAST_SLEPT < 24000L`.
  for (const v of vs) v.vbLastSlept = 0;
  // cloud owed-village-owed: NO poll. Ticking the population alone never summons (the old
  // 100-tick poll is gone) ...
  for (let t = 0; t < 300; t++) { M.Sky.dayTime = t; for (const v of vs) Village.tick(v); }
  okAv(EL.list.filter(e => e.type === 'iron_golem').length === before, 'five eligible villagers that never TALK never summon — the summon rides talkWithVillager, not a poll');
  // ... a conversation does: talkWithVillager -> summonGolem(world, time, 5)
  const rnd9 = Math.random;
  ok(Village.talkWithVillager(vs[0], vs[1], 300, rnd9) === true, 'two of them talk');
  const after = EL.list.filter(e => e.type === 'iron_golem').length;
  ok(after === before + 1, `exactly one iron golem was summoned by the conversation once 5 eligible villagers were in range (SUMMON_QUORUM), got ${after - before} new golem(s)`);
  ok(vs.every(v => v.golemDetectedUntil > 0), 'and every villager in range now carries the GOLEM_DETECTED_TICKS cooldown (GolemLastSeenSensor.rememberIronGolem\'s own 600-tick literal)');

  // ANTI-VACUITY: a second, fresh pair talking at once does NOT spawn another golem — the
  // cooldown just set above is what refuses it, not luck
  ok(Village.talkWithVillager(vs[2], vs[3], 301, rnd9) === true, 'a second pair still talks (their own windows are clear)');
  const afterAgain = EL.list.filter(e => e.type === 'iron_golem').length;
  okAv(afterAgain === after, `with the SAME 5 villagers still in range, no second golem spawns — the 600-tick cooldown (golemDetectedUntil) is refusing it, got ${afterAgain - after} more`);
  EL.clear();

  // summonGolem remembers the golem on EVERY villager in the box ($$4), not only the eligible ones
  const vs3 = [];
  for (let i = 0; i < 6; i++) vs3.push(EL.spawn('villager', i, PLAT_Y + 1, 0));
  M.Sky = { dayTime: 50000 };
  for (let i = 0; i < 5; i++) vs3[i].vbLastSlept = 50000;       // vs3[5] has never slept: ineligible
  ok(Village.talkWithVillager(vs3[0], vs3[1], 50000, rnd9) === true && EL.list.some(e => e.type === 'iron_golem'), 'five eligible + one ineligible villager: the talk summons');
  okAv(vs3[5].golemDetectedUntil > 50000, 'the ineligible (never-slept) villager in the box remembers the golem too — rememberIronGolem runs over the whole box, not the filtered list');
  EL.clear();

  // ANTI-VACUITY: fewer than SUMMON_QUORUM eligible villagers never spawns one at all
  const vs2 = [];
  for (let i = 0; i < 4; i++) vs2.push(EL.spawn('villager', i, PLAT_Y + 1, 0));
  M.Sky = { dayTime: 100000 };   // a fresh dayTime, well clear of any prior cooldown
  for (const v of vs2) v.vbLastSlept = 100000;
  Village.talkWithVillager(vs2[0], vs2[1], 100000, rnd9);
  okAv(EL.list.filter(e => e.type === 'iron_golem').length === 0, 'four villagers (one short of SUMMON_QUORUM=5) talking never trigger a spawn — proving §9 above reads the quorum, not just "any villagers present"');
  EL.clear();
  delete M.Sky;
}

// ═══ 10. gossip SHARING — VillagerGossips.shareGossipFrom / VillagerEntity.talkWithVillager (s101) ═══
console.log('\n 10. two villagers talking share gossip (shareGossipFrom: value - shareDecrement, >=2, max-merge; 1200-tick window)');
{
  const G = Village.GOSSIP;
  // the table is the jar's (.decomp VillageGossipType <clinit>, 5th arg), not this check's own numbers
  const src = readFileSync(new URL('../.decomp/net/minecraft/village/VillageGossipType.java', import.meta.url), 'utf8');
  const rows = [...src.matchAll(/\("(\w+)", (-?\d+), (\d+), (\d+), (\d+)\)/g)];
  ok(rows.length === 5, `the jar's VillageGossipType table parsed 5 rows, got ${rows.length}`);
  for (const m of rows)
    ok(G[m[1]] && G[m[1]].share === +m[5], `${m[1]}.shareDecrement = ${m[5]} per the jar, engine has ${G[m[1]] && G[m[1]].share}`);
  EL.clear();
  const a = EL.spawn('villager', 0, PLAT_Y + 1, 0), b = EL.spawn('villager', 1, PLAT_Y + 1, 0);
  b.gossip = { major_negative: 25, minor_negative: 25, trading: 2 };
  const seq = [0.0, 0.5, 0.99, 0.2, 0.7, 0.1, 0.9, 0.3, 0.6, 0.8]; let qi = 0; const rnd = () => seq[qi++ % seq.length];
  ok(Village.talkWithVillager(a, b, 5000, rnd) === true, 'two villagers outside their 1200-tick windows talk');
  ok(a.gossip && a.gossip.major_negative === 15, `major_negative 25 - shareDecrement 10 = 15 reaches the listener, got ${JSON.stringify(a.gossip)}`);
  ok(a.gossip && a.gossip.minor_negative === 5, `minor_negative 25 - 20 = 5 reaches the listener, got ${JSON.stringify(a.gossip)}`);
  ok(!a.gossip || !a.gossip.trading, 'trading 2 - 20 < 2 is dropped (the >=2 floor), never shared');
  ok(b.gossip.major_negative === 25, 'the SPEAKER keeps its own gossip unchanged (talkWithVillager shares one way: the caller receives)');
  ok(a.gossipStartTime === 5000 && b.gossipStartTime === 5000, 'both villagers\' gossipStartTime restart');
  b.gossip.major_negative = 60;
  okAv(Village.talkWithVillager(a, b, 5000 + 1199, rnd) === false && a.gossip.major_negative === 15, 'inside the 1200-tick window a second talk is refused — the window is read, not ignored');
  ok(Village.talkWithVillager(a, b, 5000 + 1200, () => 0) === true && a.gossip.major_negative === 50, `at +1200 they talk again and 60-10=50 max-merges over 15, got ${a.gossip.major_negative}`);
  a.gossip.major_negative = 90;
  Village.talkWithVillager(a, b, 5000 + 2400, () => 0);
  okAv(a.gossip.major_negative === 90, `max-merge, not a sum: a held 90 against a shared 50 stays 90, got ${a.gossip.major_negative}`);
  // weighting: pickGossips draws proportional to |value| — a draw of 0 lands on the first entry
  const w = { gossip: { minor_negative: 30, trading: 10 } };
  ok(JSON.stringify(Village.pickGossips(w, () => 0.0, 1)) === '["minor_negative"]', 'r=0 of total 40 lands on the first cumulative bucket');
  ok(JSON.stringify(Village.pickGossips(w, () => 0.8, 1)) === '["trading"]', 'r=32 of total 40 lands in trading\'s 30..39 bucket');
  ok(Village.pickGossips(w, () => 0.0, 10).length === 1, 'ten identical draws add ONE entry (the identity set)');
  // the tick path is GatherItemsVillagerTask's per-tick body (VBGather.tick) — vbgathercheck
  // proves it; here: Village.tick (gossip decay) no longer converses on its own
  EL.clear();
  const p = EL.spawn('villager', 0, PLAT_Y + 1, 0), q = EL.spawn('villager', 2, PLAT_Y + 1, 0);
  q.gossip = { major_negative: 40 };
  M.Sky = { dayTime: 200000 };
  for (let t = 0; t < 300; t++) { M.Sky.dayTime = 200000 + t; Village.tick(p); }
  okAv(!p.gossip || !p.gossip.major_negative, 'Village.tick alone never converses — the old 100-tick poll is gone');
  EL.clear(); delete M.Sky;
}

// ═══ 11. GolemLastSeenSensor.senseIronGolem — a villager that SEES a golem stops summoning ═══
console.log('\n 11. GolemLastSeenSensor: a golem within 16 blocks sets GOLEM_DETECTED_RECENTLY (600) on the 200-tick sensor, and blocks canSummonGolem');
{
  EL.clear();
  M.Sky = { dayTime: 400000 };
  const v = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  v.vbLastSlept = 400000;
  ok(Village.canSummonGolem(v, 400000), 'setup: a villager that slept just now and has seen no golem may summon');
  EL.spawn('iron_golem', 10, PLAT_Y + 1, 0);
  let fired = -1;
  for (let t = 0; t < Village.GOLEM_SENSE_INTERVAL + 1 && fired < 0; t++) { M.Sky.dayTime = 400000 + t; Village.tick(v); if (v.golemDetectedUntil) fired = t; }
  ok(fired >= 0 && fired < Village.GOLEM_SENSE_INTERVAL, `the sensor fired inside its first 200-tick window (RANDOM.nextInt(200) offset), at t=${fired}`);
  ok(v.golemDetectedUntil === 400000 + fired + Village.GOLEM_DETECTED_TICKS, 'and remembered GOLEM_DETECTED_RECENTLY for exactly 600 ticks');
  okAv(!Village.canSummonGolem(v, 400000 + fired), 'so this villager can no longer summon — the sensor feeds canSummonGolem');
  v.golemDetectedUntil = undefined;
  for (let t = 1; t < Village.GOLEM_SENSE_INTERVAL; t++) { M.Sky.dayTime = 400000 + fired + t; Village.tick(v); }
  okAv(!v.golemDetectedUntil, 'between fires (199 ticks) it does not re-sense — the 200-tick interval is real, not every tick');
  Village.tick(v);
  ok(v.golemDetectedUntil > 0, 'and on the 200th tick it senses again');
  EL.clear();
  const v2 = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  EL.spawn('iron_golem', 17, PLAT_Y + 1, 0);
  for (let t = 0; t < 401; t++) Village.tick(v2);
  okAv(!v2.golemDetectedUntil, 'a golem 17 blocks away (outside the 16-block MOBS box) is never sensed');
  EL.clear(); delete M.Sky;
}

// ═══ 12. notifyDeath's observer set — the victim's VISIBLE_MOBS cache (16-box, TARGET_PREDICATE) ═══
console.log('\n 12. VILLAGER_KILLED reaches villagers the victim could SEE within 16 blocks — not through a wall, not at 17, not an invisible one past 2');
freshWorld();
plate(30);
{
  const victim = EL.spawn('villager', 0, PLAT_Y + 1, 0);
  const at13 = EL.spawn('villager', 13, PLAT_Y + 1, 0);
  const at17 = EL.spawn('villager', 0, PLAT_Y + 1, 17);
  const walled = EL.spawn('villager', -6, PLAT_Y + 1, 0);
  for (let y = PLAT_Y + 1; y <= PLAT_Y + 4; y++) for (let z = -2; z <= 2; z++) W.setBlock(-3, y, z, STONE);
  const inv = EL.spawn('villager', 0, PLAT_Y + 1, -3);
  M.Effects.addStatusEffect(inv, 'invisibility', 600, 0);
  const obs = Village.deathObservers(victim);
  ok(obs.includes(at13), 'a villager 13 blocks away in plain sight is an observer (TARGET_PREDICATE\'s 16, not the old 10-box)');
  okAv(!obs.includes(at17), 'one 17 blocks away is not (outside the 16-block MOBS box / base max distance)');
  okAv(!obs.includes(walled), 'one 6 blocks away behind a stone wall is not — the victim must SEE it (canSee)');
  okAv(!obs.includes(inv), 'an invisible, unarmoured villager 3 blocks away is not — max(16*0.7*0.1, 2) = 2 blocks');
  inv.z = -1.5;
  ok(Village.deathObservers(victim).includes(inv), 'but the same invisible villager 1.5 blocks away is (inside the floor of 2)');
  ok(!obs.includes(victim), 'the victim never observes itself');
  EL.clear();
}

console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
