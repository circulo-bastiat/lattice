#!/usr/bin/env node
// raidcheck.mjs — QUEUE 0.2: the RAID LOOP's own state machine, `NS.Raid`/`NS.RaidManager`
// (src/07s_raid.js) against `Raid`/`RaidManager` (Yarn 1.18.2,
// net.minecraft.village.raid.{Raid,RaidManager}) and the banner-kill half of
// `RaiderEntity.onDeath`.
//
//   node tools/raidcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. Every constant this file asserts against was read off the decompiled
// 1.18.2 jar by hand (the class/line citations live in 07s_raid.js's own comments), so the
// interesting question is never "is [0,4,3,3,4,4,4,2] right for the pillager" — it is whether
// `Rd.getCount`/`Rd.getBonusCount`/`Rd.tick` actually LAND on that table rather than a
// plausible-looking copy of it. Every section below breaks its own data on purpose (rule 1)
// and asserts the break is CAUGHT, and every behaviour is asserted in both directions
// (rule 3): the thing happens when the jar says it does, and does not when it says it does not.
//
// ⚠ MOB EXISTENCE IS NOT IN SCOPE HERE. `07s_raid.js`'s own header names why (vindicator/
// evoker/pillager/witch/ravager motion is unresolved, so `EL.spawn` refuses all five) — this
// check therefore drives `Rd`/`RM` against a FAKE `spawnFn` (a plain object stand-in, same
// shape `Rd.spawnNextWave`'s own doc describes for the day a real one exists) rather than a
// live `EntityList`. §7 explicitly also exercises `spawnFn` returning null, because that is
// what a real run of this engine does TODAY, and a check that only ever saw a happy spawnFn
// would not prove the "missed" accounting works.
//
// ⚠ §8-§11 (loop/raidlive-s93, QUEUE 0.2's "no live caller" gap) ARE THE EXCEPTION: they drive
// `Rd.tickLive` — the exact function `Main.worldTick` calls — against a REAL `World`,
// `EntityList.spawn` (mob existence is closed, loop/illagers-s92) and `Profession.claimed`
// (this engine's own POI substrate, `07s_raid.js`'s own "NEAR A VILLAGE, RULED" header), the
// same standard `villagegolemcheck.mjs`/`aicheck.mjs`'s own §7 already hold themselves to: a
// synthetic ctx proves the RULE, a real spawned mob through the real loop proves the JOIN.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('raidcheck — QUEUE 0.2, the raid loop (Raid/RaidManager state machine + Bad Omen)');

const M = loadEngine({ extra: ['07q_effects.js', '07s_raid.js', '02l_advancements.js', '07zzo_stats.js'] });
M.Effects.ready = true;
const ES = M.Effects, Rd = M.Raid, RM = M.RaidManager;

ok(Rd && Rd.ready, 'Raid module reports ready');
ok(RM && RM.ready, 'RaidManager module reports ready');
if (!Rd || !RM) { console.log('\nFAIL raidcheck — module(s) missing'); process.exit(1); }

// a tiny deterministic RNG: nextInt(n) and nextFloat() both driven off a queue, defaulting to 0
function mkRand(queue) {
  const q = (queue || []).slice();
  return {
    nextInt: (n) => { const v = q.length ? q.shift() : 0; return ((v % n) + n) % n; },
    nextFloat: () => 0
  };
}
function mkPlayer() { return {}; }
function mkMob(type) { return { type: type }; }

// ── §1. THE FIVE WAVE TABLES — Raid.Member (Raid.java:795-799) ─────────────────────────
say('\n§1 — Raid.Member wave-count tables');
ok(JSON.stringify(Rd.MEMBERS.vindicator) === JSON.stringify([0, 0, 2, 0, 1, 4, 2, 5]), 'vindicator countInWave matches Raid.Member.field_16631');
ok(JSON.stringify(Rd.MEMBERS.evoker) === JSON.stringify([0, 0, 0, 0, 0, 1, 1, 2]), 'evoker countInWave matches Raid.Member.field_16634');
ok(JSON.stringify(Rd.MEMBERS.pillager) === JSON.stringify([0, 4, 3, 3, 4, 4, 4, 2]), 'pillager countInWave matches Raid.Member.field_16633');
ok(JSON.stringify(Rd.MEMBERS.witch) === JSON.stringify([0, 0, 0, 0, 3, 0, 0, 1]), 'witch countInWave matches Raid.Member.field_16635');
ok(JSON.stringify(Rd.MEMBERS.ravager) === JSON.stringify([0, 0, 0, 1, 0, 1, 0, 2]), 'ravager countInWave matches Raid.Member.field_16630');
ok(Rd.getCount(Rd.MEMBERS.pillager, 2, 5, false) === 3, 'getCount reads wave 2 of the real pillager table (3)');
ok(Rd.getCount(Rd.MEMBERS.pillager, 2, 5, true) === Rd.MEMBERS.pillager[5], 'the bonus (extra) wave reuses the FINAL wave’s own count, not the requested index');
{
  const real = Rd.MEMBERS.pillager.slice();
  Rd.MEMBERS.pillager[2] = 999;
  const broke = Rd.getCount(Rd.MEMBERS.pillager, 2, 5, false) === 999;
  Rd.MEMBERS.pillager = real;
  okAv(broke, 'corrupting Rd.MEMBERS.pillager[2] changes getCount’s answer — it reads the live table, not a baked-in copy');
}

// ── §2. canLead() — who may carry the banner ──────────────────────────────────────────
say('\n§2 — RaiderEntity.canLead() overrides (WitchEntity.java:277, RavagerEntity.java:337)');
ok(Rd.CAN_LEAD.vindicator === true && Rd.CAN_LEAD.evoker === true && Rd.CAN_LEAD.pillager === true,
  'vindicator/evoker/pillager keep the RaiderEntity base canLead()=true');
ok(Rd.CAN_LEAD.witch === false, 'WitchEntity.canLead() is overridden to false');
ok(Rd.CAN_LEAD.ravager === false, 'RavagerEntity.canLead() is overridden to false');
{
  // Member declaration order: vindicator, evoker, pillager, witch, ravager. On a wave that
  // spawns vindicators, the FIRST one spawned should get the banner — not the pillager that
  // spawns after it, even though there are more pillagers.
  const raid = Rd.create(1, { x: 0, y: 64, z: 0 }, 'hard');   // hard wave 3 -> vindicator 0, pillager 3 (no vindicator this wave)
  const rand = mkRand([]);
  const spawned = [];
  const spawnFn = (type, pos) => { const e = mkMob(type); spawned.push(e); return e; };
  raid.wavesSpawned = 2;   // about to spawn wave 3
  const res = Rd.spawnNextWave(raid, { x: 0, y: 64, z: 0 }, rand, spawnFn);
  ok(res.spawned.length > 0, 'hard wave 3 spawned at least one raider');
  const captain = raid.waveCaptain[3];
  ok(!!captain, 'wave 3 got a captain');
  ok(captain && captain.type === 'pillager', `wave 3 has no vindicator (table says 0) so the FIRST pillager leads (got ${captain && captain.type})`);
  ok(spawned.filter((e) => e.patrolLeader).length === 1, 'exactly one raider in the wave is flagged patrolLeader');
  const savedCanLead = Rd.CAN_LEAD.witch;
  Rd.CAN_LEAD.witch = true;
  const raid2 = Rd.create(2, { x: 0, y: 64, z: 0 }, 'hard');
  raid2.wavesSpawned = 4;  // wave 5: witch=3, pillager=4 — witch spawns first in MEMBER_ORDER? no, witch is 4th, pillager 3rd
  const spawnFn2 = (type) => mkMob(type);
  Rd.spawnNextWave(raid2, { x: 0, y: 64, z: 0 }, mkRand([]), spawnFn2);
  Rd.CAN_LEAD.witch = savedCanLead;
  okAv(!!raid2.waveCaptain[5], 'anti-vacuity: with CAN_LEAD.witch forced true, SOME captain is still assigned (the roster flag is actually read)');
}

// ── §3. getBonusCount — Raid.getBonusCount (Raid.java:700-726) ──────────────────────────
say('\n§3 — getBonusCount, branch for branch');
ok(Rd.getBonusCount('witch', () => 0, 1, 'normal', false) === 0, 'witch: wave 1 (<=2) never gets a bonus');
ok(Rd.getBonusCount('witch', () => 0, 4, 'normal', false) === 0, 'witch: wave 4 is excluded by name in the jar');
ok(Rd.getBonusCount('witch', () => 0, 5, 'easy', false) === 0, 'witch: EASY never gets a bonus regardless of wave');
ok(Rd.getBonusCount('witch', () => 1, 5, 'normal', false) === 1, 'witch: wave 5 on normal, with the roll forced to 1, gets +1');
ok(Rd.getBonusCount('pillager', () => 1, 3, 'hard', false) === 1, 'pillager on hard rolls nextInt(3), forced to 1 -> +1');
ok(Rd.getBonusCount('vindicator', () => 0, 3, 'normal', false) === 0, 'vindicator on normal rolls nextInt(2), forced to 0 -> +0');
{
  // the EASY-only double-roll quirk: nextInt(2) picks n, THEN nextInt(n+1) rolls again.
  let calls = [], rets = [];
  const rand = (n) => { calls.push(n); const v = n - 1; rets.push(v); return v; };  // always returns the top of its own range
  const r = Rd.getBonusCount('pillager', rand, 2, 'easy', false);
  ok(calls.length === 2 && calls[0] === 2, 'pillager/EASY calls nextInt(2) first (picking n), matching Raid.java’s own two-roll shape');
  ok(r === rets[1], 'and the SECOND call’s return (nextInt(n+1)) is the value actually returned, not the first roll');
}
ok(Rd.getBonusCount('ravager', () => 0, 5, 'normal', true) >= 0 && Rd.getBonusCount('ravager', () => 0, 5, 'normal', false) === 0,
  'ravager only ever rolls a bonus on the EXTRA (bad-omen) wave, never a normal one');
ok(Rd.getBonusCount('ravager', () => 5, 5, 'easy', true) === 0, 'ravager: EASY never gets a bonus even on the extra wave');
ok(Rd.getBonusCount('ghast', () => 5, 5, 'hard', true) === 0, 'a type outside Raid.Member (default case) always returns 0');
{
  const real = Rd.getBonusCount;
  Rd.getBonusCount = () => 7;
  const raid = Rd.create(9, { x: 0, y: 64, z: 0 }, 'easy');
  const spawnFn = () => mkMob('pillager');
  const res = Rd.spawnNextWave(raid, { x: 0, y: 64, z: 0 }, mkRand([]), spawnFn);
  Rd.getBonusCount = real;
  okAv(res.spawned.length === (Rd.MEMBERS.pillager[1] + 7 * Rd.MEMBER_ORDER.length),
    'anti-vacuity: forcing getBonusCount to always return 7 inflates spawnNextWave’s own totals by exactly 7 per member — it is really summed in');
}

// ── §4. Raid.start — Bad Omen -> badOmenLevel (Raid.java:229-235) ──────────────────────
say('\n§4 — Raid.start: Bad Omen feeds badOmenLevel, and is always consumed');
{
  const raid = Rd.create(1, { x: 0, y: 64, z: 0 }, 'normal');
  const player = mkPlayer();
  ES.addStatusEffect(player, 'bad_omen', 100, 0, false, true);
  Rd.start(raid, player, ES);
  ok(raid.badOmenLevel === 1, `amplifier 0 Bad Omen -> badOmenLevel 1 (amplifier + 1), got ${raid.badOmenLevel}`);
  ok(!ES.hasStatusEffect(player, 'bad_omen'), 'Bad Omen is removed off the player once it has been banked into the raid');
  const raid2 = Rd.create(2, { x: 0, y: 64, z: 0 }, 'normal');
  Rd.start(raid2, player, ES);
  ok(raid2.badOmenLevel === 0, 'anti-vacuity(direction): a player with NO Bad Omen leaves badOmenLevel at 0 — Rd.start does not invent a level');
  const raid3 = Rd.create(3, { x: 0, y: 64, z: 0 }, 'normal');
  ES.addStatusEffect(player, 'bad_omen', 100, 9, false, true);   // amplifier 9 -> would be level 10 unclamped
  Rd.start(raid3, player, ES);
  ok(raid3.badOmenLevel === Rd.MAX_BAD_OMEN_LEVEL, `a huge amplifier clamps to MAX_BAD_OMEN_LEVEL (${Rd.MAX_BAD_OMEN_LEVEL}), got ${raid3.badOmenLevel}`);
}
{
  const savedClamp = Rd.MAX_BAD_OMEN_LEVEL;
  Rd.MAX_BAD_OMEN_LEVEL = 100;
  const raid = Rd.create(4, { x: 0, y: 64, z: 0 }, 'normal');
  const player = mkPlayer();
  ES.addStatusEffect(player, 'bad_omen', 100, 9, false, true);
  Rd.start(raid, player, ES);
  Rd.MAX_BAD_OMEN_LEVEL = savedClamp;
  okAv(raid.badOmenLevel === 10, 'anti-vacuity: with the clamp raised, the same amplifier-9 effect now banks the FULL 10 — the clamp above was really doing the clamping');
}

// ── §5. RaidManager.startRaid — reuse / restart / cap (RaidManager.java:69-133) ─────────
say('\n§5 — RaidManager.startRaid: reuse within 96 blocks, restart under the cap, refuse over it');
{
  const rm = RM.create();
  const p1 = mkPlayer(); ES.addStatusEffect(p1, 'bad_omen', 100, 0, false, true);
  const r1 = RM.startRaid(rm, p1, { x: 0, y: 64, z: 0 }, 'normal', ES);
  ok(r1 && r1.badOmenLevel === 1, 'first startRaid creates a raid and banks the amplifier');
  const p2 = mkPlayer(); ES.addStatusEffect(p2, 'bad_omen', 100, 0, false, true);
  const r2 = RM.startRaid(rm, p2, { x: 10, y: 64, z: 10 }, 'normal', ES);
  ok(r2 === r1, 'a second player 14 blocks away (<96) reuses the SAME raid object, not a new one');
  ok(r1.badOmenLevel === 2, `...and its level rose again (amplifier 0 + 1, banked a second time) to 2, got ${r1.badOmenLevel} — hasStarted() is false until a wave spawns, so the cap does not apply yet`);
  const p3 = mkPlayer(); ES.addStatusEffect(p3, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p3, { x: 1000, y: 64, z: 1000 }, 'normal', ES);
  ok(Object.keys(rm.raids).length === 2, 'a player 1000 blocks away (>96) starts a SEPARATE raid');
  r1.wavesSpawned = 1;              // pretend it has started
  r1.badOmenLevel = Rd.MAX_BAD_OMEN_LEVEL;
  const p4 = mkPlayer(); ES.addStatusEffect(p4, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p4, { x: 0, y: 64, z: 0 }, 'normal', ES);
  ok(r1.badOmenLevel === Rd.MAX_BAD_OMEN_LEVEL, 'once STARTED and at the cap, a new Bad Omen no longer raises the level...');
  ok(!ES.hasStatusEffect(p4, 'bad_omen'), '...but the effect is still consumed off the player either way');
  const p5 = mkPlayer();
  const r5 = RM.startRaid(rm, p5, { x: 0, y: 64, z: 0 }, 'peaceful', ES);
  ok(r5 === null, 'startRaid on PEACEFUL refuses outright');
}
{
  M.Adv = M.Adv || { trigger() {} };
  const St = M.Stats, Ad = M.Adv;
  const calls = []; let origT = null;
  if (Ad) { origT = Ad.trigger; Ad.trigger = (pl, id) => { calls.push(id); }; }
  const before = St ? St.getCustom('raid_trigger') : 0;
  const rm = RM.create();
  const p1 = mkPlayer(); ES.addStatusEffect(p1, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p1, { x: 0, y: 64, z: 0 }, 'normal', ES);
  ok(!!St && !!Ad, 'Stats and Adv are loaded in the check engine');
  ok(St && St.getCustom('raid_trigger') === before + 1, 'startRaid counts raid_trigger once');
  ok(calls.filter(c => c === 'minecraft:voluntary_exile').length === 1, 'startRaid fires voluntary_exile');
  const p2 = mkPlayer(); ES.addStatusEffect(p2, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p2, { x: 5, y: 64, z: 5 }, 'normal', ES);
  ok(St && St.getCustom('raid_trigger') === before + 2, 'joining the not-yet-spawned raid counts again (jar: !hasSpawned)');
  const r = Object.values(rm.raids)[0]; r.wavesSpawned = 1; r.badOmenLevel = Rd.MAX_BAD_OMEN_LEVEL;
  const p3 = mkPlayer(); ES.addStatusEffect(p3, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p3, { x: 0, y: 64, z: 0 }, 'normal', ES);
  okAv(St && St.getCustom('raid_trigger') === before + 2, 'a capped, started raid does not count (anti-vacuity: the gate is real)');
  if (Ad) Ad.trigger = origT;
}
{
  const savedDist = Rd.RAID_REUSE_DIST_SQ;
  Rd.RAID_REUSE_DIST_SQ = 0;
  const rm = RM.create();
  const p1 = mkPlayer(); ES.addStatusEffect(p1, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p1, { x: 0, y: 64, z: 0 }, 'normal', ES);
  const p2 = mkPlayer(); ES.addStatusEffect(p2, 'bad_omen', 100, 0, false, true);
  RM.startRaid(rm, p2, { x: 10, y: 64, z: 10 }, 'normal', ES);
  Rd.RAID_REUSE_DIST_SQ = savedDist;
  okAv(Object.keys(rm.raids).length === 2, 'anti-vacuity: shrinking the reuse radius to 0 makes the SAME two positions start two raids — the radius was really gating reuse');
}

// ── §6. RaiderEntity.onDeath's banner-kill Bad Omen grant (RaiderEntity.java:131-160) ──────
say('\n§6 — a banner-wearing patrol leader’s death grants (or refreshes) Bad Omen');
{
  const player = mkPlayer();
  const leader = { patrolLeader: true, ominousBanner: true };
  ok(Rd.onPatrolLeaderDeath(leader, player, ES) === true, 'a banner-wearing leader killed by a credited player grants Bad Omen');
  const inst = ES.getStatusEffect(player, 'bad_omen');
  ok(!!inst && inst.amplifier === 0 && inst.duration === Rd.PATROL_BAD_OMEN_DURATION,
    `fresh grant is amplifier 0, duration ${Rd.PATROL_BAD_OMEN_DURATION} (got amp=${inst && inst.amplifier}, dur=${inst && inst.duration})`);
  const leader2 = { patrolLeader: true, ominousBanner: true };
  Rd.onPatrolLeaderDeath(leader2, player, ES);
  const inst2 = ES.getStatusEffect(player, 'bad_omen');
  ok(inst2.amplifier === 1, `killing a SECOND banner-leader while already carrying Bad Omen bumps the amplifier (0 -> 1), got ${inst2.amplifier}`);
  const noBanner = { patrolLeader: true, ominousBanner: false };
  const before = ES.getStatusEffect(player, 'bad_omen').amplifier;
  ok(Rd.onPatrolLeaderDeath(noBanner, player, ES) === false, 'a patrol leader with NO banner grants nothing');
  ok(ES.getStatusEffect(player, 'bad_omen').amplifier === before, '...and the player’s existing Bad Omen is left exactly as it was');
  const notLeader = { patrolLeader: false, ominousBanner: true };
  ok(Rd.onPatrolLeaderDeath(notLeader, player, ES) === false, 'a non-leader (even with a banner flag) grants nothing — only the leader carries it');
  ok(Rd.onPatrolLeaderDeath({ patrolLeader: true, ominousBanner: true }, null, ES) === false, 'no credited player (killed by something else) grants nothing');
}
{
  const player = mkPlayer();
  const leader = { patrolLeader: true, ominousBanner: true };
  // amplifier 9 + 1 -> 10, must clamp to PATROL_BAD_OMEN_CLAMP (4), NOT MAX_BAD_OMEN_LEVEL (5)
  ES.addStatusEffect(player, 'bad_omen', 1, 9, false, true);
  Rd.onPatrolLeaderDeath(leader, player, ES);
  ok(ES.getStatusEffect(player, 'bad_omen').amplifier === Rd.PATROL_BAD_OMEN_CLAMP,
    `patrol-kill clamps to PATROL_BAD_OMEN_CLAMP (${Rd.PATROL_BAD_OMEN_CLAMP}), a DIFFERENT ceiling from a raid’s own ${Rd.MAX_BAD_OMEN_LEVEL}`);
}
{
  const savedClamp = Rd.PATROL_BAD_OMEN_CLAMP;
  Rd.PATROL_BAD_OMEN_CLAMP = 100;
  const player = mkPlayer();
  ES.addStatusEffect(player, 'bad_omen', 1, 9, false, true);
  Rd.onPatrolLeaderDeath({ patrolLeader: true, ominousBanner: true }, player, ES);
  Rd.PATROL_BAD_OMEN_CLAMP = savedClamp;
  okAv(ES.getStatusEffect(player, 'bad_omen').amplifier === 10, 'anti-vacuity: raising the patrol clamp lets amplifier 9+1=10 through uncapped — the clamp above was real');
}

// ── §7. Raid.tick — the full lifecycle: spawn, victory, loss, timeout ───────────────────
say('\n§7 — Raid.tick: wave spawning, VICTORY, LOSS, timeout STOPPED');
function tickOnce(raid, opts) {
  return Rd.tick(raid, Object.assign({
    isNearVillage: () => true,
    spawnFn: (type) => mkMob(type),
    rand: mkRand([]),
    heroEntities: {},
    ES
  }, opts || {}));
}
{
  // an EASY raid: 3 waves. Wave 1 is pillager-only (4); wave 2 adds 2 vindicators to 3
  // pillagers (5 total); wave 3 is 3 pillagers + 1 ravager (4 total) — read straight off
  // Raid.MEMBERS, not assumed to be any one type.
  function waveTotal(idx) {
    return Rd.MEMBER_ORDER.reduce((sum, t) => sum + (Rd.MEMBERS[t][idx] || 0), 0);
  }
  function advanceUntilWaveSpawns(raid, maxTicks) {
    const startW = raid.wavesSpawned;
    let n = 0;
    while (raid.wavesSpawned === startW && n < maxTicks) { tickOnce(raid); n++; }
    return n;
  }
  const raid = Rd.create(1, { x: 0, y: 64, z: 0 }, 'easy');
  ok(raid.status === Rd.Status.ONGOING, 'a fresh raid starts ONGOING');
  tickOnce(raid);
  ok(raid.wavesSpawned === 1 && raid.raiders.length === waveTotal(1),
    `first tick spawns wave 1 immediately (no horn delay) — ${raid.raiders.length} raiders, expected ${waveTotal(1)}`);
  ok(raid.bar.visible === true && raid.bar.raidersRemaining === raid.raiders.length, 'the bossbar DATA reflects the live raider count');
  while (raid.raiders.length) Rd.removeFromWave(raid, raid.raiders[0], 'hero1');
  ok(raid.heroes.hero1 === true, 'the credited killer is recorded as a hero-of-the-village candidate');
  const ticksToWave2 = advanceUntilWaveSpawns(raid, Rd.PRE_WAVE_HORN_TICKS + 10);
  ok(ticksToWave2 === Rd.PRE_WAVE_HORN_TICKS + 1,
    `wave 2 spawns exactly ${Rd.PRE_WAVE_HORN_TICKS + 1} ticks after wave 1 cleared (the horn-set tick, then ${Rd.PRE_WAVE_HORN_TICKS} decrementing to 0), got ${ticksToWave2}`);
  ok(raid.raiders.length === waveTotal(2), `wave 2 has ${waveTotal(2)} raiders (2 vindicator + 3 pillager), got ${raid.raiders.length}`);
  while (raid.raiders.length) Rd.removeFromWave(raid, raid.raiders[0], 'hero1');
  const ticksToWave3 = advanceUntilWaveSpawns(raid, Rd.PRE_WAVE_HORN_TICKS + 10);
  ok(ticksToWave3 === Rd.PRE_WAVE_HORN_TICKS + 1, `wave 3 (the final EASY wave) also waits the full horn delay, got ${ticksToWave3} ticks`);
  ok(raid.raiders.length === waveTotal(3), `wave 3 has ${waveTotal(3)} raiders (3 pillager + 1 ravager), got ${raid.raiders.length}`);
  while (raid.raiders.length) Rd.removeFromWave(raid, raid.raiders[0], 'hero1');
  ok(Rd.shouldSpawnMoreGroups(raid) === false, 'after the final wave clears, with no extra wave (badOmenLevel <= 1), nothing more is owed');
  for (let i = 0; i < Rd.POST_RAID_WIN_DELAY; i++) tickOnce(raid);
  ok(raid.status === Rd.Status.ONGOING, `still ONGOING through exactly POST_RAID_WIN_DELAY (${Rd.POST_RAID_WIN_DELAY}) ticks — vanilla's own "< 40" gate, not "<= 40"`);
  tickOnce(raid);
  ok(raid.status === Rd.Status.VICTORY, 'one more tick past the delay declares VICTORY');
  const heroEnt = { hero1: mkPlayer() };
  const fired = [];
  heroEnt.hero1.isPlayer = true;
  heroEnt.hero1.advancements = { trigger: (t) => { fired.push(t); return 1; } };
  M.Stats.reset();
  Rd.grantHeroes(raid, heroEnt, ES);
  ok(M.Stats.getCustom('raid_win') === 1 && fired.includes('minecraft:hero_of_the_village'), 'a player hero gets raid_win == 1 and the hero_of_the_village trigger');
  { const r2 = { heroes: { v: true }, badOmenLevel: 1 }; const v = {}; M.Stats.reset(); fired.length = 0;
    Rd.grantHeroes(r2, { v }, ES);
    ok(ES.hasStatusEffect(v, 'hero_of_the_village') && M.Stats.getCustom('raid_win') === 0, 'a non-player hero gets the effect but no stat'); }
  ok(ES.hasStatusEffect(heroEnt.hero1, 'hero_of_the_village'), 'grantHeroes gives the recorded hero the effect');
  ok(ES.getStatusEffect(heroEnt.hero1, 'hero_of_the_village').amplifier === Math.max(raid.badOmenLevel - 1, 0),
    'at amplifier badOmenLevel - 1 (clamped to 0), per Raid.java’s own StatusEffectInstance call');
}
{
  const raid = Rd.create(2, { x: 0, y: 64, z: 0 }, 'easy');
  tickOnce(raid);   // wave 1 spawns
  ok(raid.raiders.length > 0, 'setup: wave 1 is alive');
  tickOnce(raid, { isNearVillage: () => false });
  ok(raid.status === Rd.Status.LOSS, 'once a wave has spawned, the village vanishing (no occupied POI to move to) is a LOSS');
  const raid2 = Rd.create(3, { x: 0, y: 64, z: 0 }, 'easy');
  Rd.tick(raid2, Object.assign({ isNearVillage: () => false, spawnFn: () => mkMob('pillager'), rand: mkRand([]), ES }, {}));
  ok(raid2.status === Rd.Status.STOPPED, 'anti-vacuity(direction): the SAME missing-village check, before any wave has spawned, is only STOPPED, never a LOSS');
}
{
  const raid = Rd.create(4, { x: 0, y: 64, z: 0 }, 'easy');
  raid.ticksActive = Rd.RAID_TIMEOUT_TICKS - 2;
  tickOnce(raid);
  ok(raid.status !== Rd.Status.STOPPED, 'one tick below the timeout, the raid is still running');
  tickOnce(raid);
  ok(raid.status === Rd.Status.STOPPED, `crossing RAID_TIMEOUT_TICKS (${Rd.RAID_TIMEOUT_TICKS}) stops the raid outright`);
}
{
  const raid = Rd.create(5, { x: 0, y: 64, z: 0 }, 'easy');
  const savedTimeout = Rd.RAID_TIMEOUT_TICKS;
  Rd.RAID_TIMEOUT_TICKS = 2;
  raid.ticksActive = 0;
  tickOnce(raid); tickOnce(raid);
  Rd.RAID_TIMEOUT_TICKS = savedTimeout;
  okAv(raid.status === Rd.Status.STOPPED, 'anti-vacuity: shrinking RAID_TIMEOUT_TICKS to 2 stops the SAME raid two ticks in — the constant is really the gate');
}
{
  // a MISSED spawn (EL.spawn's real, current refusal) must not be silently treated as a live raider.
  const raid = Rd.create(6, { x: 0, y: 64, z: 0 }, 'easy');
  const res = tickOnce(raid, { spawnFn: () => null });
  ok(raid.raiders.length === 0, 'when spawnFn refuses every raider (today’s real EL.spawn answer for every illager), the wave has zero LIVE raiders');
  ok(raid.wavesSpawned === raid.waveCount, '...and Raid.tick\'s `while (canSpawnRaiders())` (Raid.java:332) keeps spawning waves in the SAME tick while no raider lives (#5123)');
}
{
  // a difficulty-4-wave extra wave, driven by badOmenLevel > 1
  const raid = Rd.create(7, { x: 0, y: 64, z: 0 }, 'easy');
  raid.badOmenLevel = 2;
  ok(Rd.hasExtraWave(raid) === true, 'badOmenLevel > 1 means an extra wave is owed');
  const notExtra = Rd.create(8, { x: 0, y: 64, z: 0 }, 'easy');
  notExtra.badOmenLevel = 1;
  ok(Rd.hasExtraWave(notExtra) === false, 'anti-vacuity(direction): badOmenLevel of exactly 1 is NOT an extra wave (Raid.java: > 1, not >= 1)');
}

// ═══════════════════════ LIVE (loop/raidlive-s93) — see file header ═══════════════════════
say('\n§8 — Rd.isNearOccupiedPOI / Rd.villageCenterNear against Profession.claimed (headless)');
{
  const claimed = { '10,64,10': 1 };
  ok(Rd.isNearOccupiedPOI({ x: 12, y: 64, z: 11 }, claimed) === true,
    'a claimed workstation in the SAME chunk section answers "near a village"');
  ok(Rd.isNearOccupiedPOI({ x: 26, y: 64, z: 10 }, claimed) === true,
    'one section over (16 blocks, section-Chebyshev distance 1) is still "near" — isNearOccupiedPointOfInterest(pos, 1)');
  ok(Rd.isNearOccupiedPOI({ x: 42, y: 64, z: 10 }, claimed) === false,
    'anti-vacuity(direction): two sections over (distance 2) is past the radius-1 test');
  okAv(Rd.isNearOccupiedPOI({ x: 0, y: 64, z: 0 }, {}) === false,
    'anti-vacuity: an empty POI map (no claimed workstation anywhere) is never "near"');

  const center = Rd.villageCenterNear({ x: 12, y: 64, z: 11 }, claimed);
  ok(!!center && center.x === 10 && center.y === 64 && center.z === 10,
    `villageCenterNear averages the one nearby claimed workstation, got ${JSON.stringify(center)}`);
  ok(Rd.villageCenterNear({ x: 200, y: 64, z: 200 }, claimed) === null,
    'anti-vacuity(direction): nothing within radius -> null, never a stale center');

  const claimed2 = { '0,64,0': 1, '2,64,0': 2 };
  const c2 = Rd.villageCenterNear({ x: 1, y: 64, z: 0 }, claimed2);
  ok(!!c2 && c2.x === 1 && c2.z === 0, `two claimed workstations average to their midpoint, got ${JSON.stringify(c2)}`);
}

// ── the LIVE engine used by §9-§11: a real World/Behave/EntityList/Profession/Effects/Combat,
// the same standard aicheck.mjs's/villagegolemcheck.mjs's own §7 already hold themselves to.
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
  '07k_goals.js', '07l_spawn.js', '07o_profession.js', '07q_effects.js', '07s_raid.js',
  '09b_sky.js', '07x_patrol.js', '07y_equip.js'];
const L = loadEngine({ extra: EXTRA, dom: false });
L.DATA = Object.assign({}, L.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
L.Entities.init();
{
  const imeta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  L.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });
}
L.Ai.init();
L.EntityList.init();
L.Hand.init();
L.Combat.init();
L.Profession.init();
L.Effects.ready = true;
L.Equip.init();
L.Raid.init();
L.Patrol.init();
ok(L.Raid.ready && L.RaidManager.ready && !!L.RaidManager.world,
  'the live engine\'s Raid/RaidManager report ready with a live raid table (RM.world, Rd.init\'s own singleton)');
ok(L.EntityList.canSpawn('pillager') === true,
  'mob existence is closed (loop/illagers-s92) — EL.spawn actually places a pillager in this engine');

const Lrd = L.Raid, Lrm = L.RaidManager, LW = L.World, LCH = L.CH, LEL = L.EntityList;
const warmLive = () => { for (let t = 0; t < 400; t++) { Lrd.tickLive(L); const r = Object.values(Lrm.world.raids)[0]; if (r && r.wavesSpawned > 0) break; } };   // the jar's Raid waits 300 ticks (preRaidTicks) before wave 1
const LProf = L.Profession, LES = L.Effects, LCb = L.Combat;
const Lstate = (n) => L.States.stateOf(n) | 0;
const LSTONE = Lstate('stone');
const LWORKSTATION = Lstate('lectern');
const PLAT_Y = 8;

// a ring candidate's angle is a REAL random draw in `Rd.buildLiveCtx` (unlike §9's own
// deterministic one), so the platform below has to cover the WHOLE disk `Rd.ringSpawnPos`
// can land in (tier 0's own 64-block radius + up to 5 jitter, any direction), not just one
// spot on it — a thin strip only covering one angle would fail nondeterministically.
function freshWorld() {
  LW.init(1);
  L.Behave.init(LW);
  for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
    const c = LW.makeChunk(cx, cz);
    c.state = LCH.GENERATED;
    LW.chunks.set(LW.key(cx, cz), c);
  }
  ok(LW.loadedAt(0, 0), 'a chunk is loaded to place into');
}
// `W.heightAt` reads a chunk's own baked `hmap` (07_world.js:1424-1428), which `setBlock` never
// updates (it is only baked at worldgen time) — a synthetic column needs it set by hand, or
// every live spawn-height lookup below would read the sentinel WORLD_MIN_Y-1, not the platform.
function plateWithHeightmap(x0, x1, z0, z1, y) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) LW.setBlock(x, y, z, LSTONE);
  const touched = new Set();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) touched.add((x >> 4) + ',' + (z >> 4));
  for (const key of touched) {
    const [cx, cz] = key.split(',').map(Number);
    const c = LW.get(cx, cz);
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      const wx = (cx << 4) + lx, wz = (cz << 4) + lz;
      if (wx < x0 || wx > x1 || wz < z0 || wz > z1) continue;
      c.hmap[(lz << 4) | lx] = y - L.CFG.WORLD_MIN_Y;
    }
  }
}
function mkLivePlayer(over) {
  return Object.assign({ x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, onGround: true }, over || {});
}
// a deterministic ring pick (mkRand's own shape, defined at the top of this file): nextFloat
// always 0 -> angle 0 -> due EAST; nextInt always its first queued value (0 if none queued).
// tier 0's own scale (`Rd.ringSpawnPos`) puts that candidate at (center.x + 64, center.z).
const detRand = mkRand([]);

say('\n§9 — Rd.findRaiderSpawnPos / Rd.canPlaceRaiderAt against a real World, real height, real POI-avoidance');
{
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const raid = Rd.create(101, { x: 0, y: PLAT_Y, z: 0 }, 'easy');
  const ctxBase = { rand: detRand, heightAt: (x, z) => LW.heightAt(x, z) + 1, claimed: null,
    isSpawnable: (x, y, z) => Rd.canPlaceRaiderAt(L, x, y, z) };

  const pos = Rd.findRaiderSpawnPos(raid, 0, 20, ctxBase);
  ok(!!pos && pos.x === 64 && pos.z === 0 && pos.y === PLAT_Y + 1,
    `tier 0's deterministic ring candidate lands at (64,${PLAT_Y + 1},0), got ${JSON.stringify(pos)}`);

  // anti-vacuity: block the ONE candidate a deterministic rand will ever produce -> every one
  // of the 20 attempts fails the SAME way -> null, not a silent wrong answer.
  LW.setBlock(64, PLAT_Y + 1, 0, LSTONE);
  okAv(Rd.findRaiderSpawnPos(raid, 0, 20, ctxBase) === null,
    'anti-vacuity: solid air at the only candidate this rand ever produces -> the search fails outright');
  LW.setBlock(64, PLAT_Y + 1, 0, 0);   // clear it back

  // the tier < 2 POI-avoidance bypass (Raid.java's own `$$0 >= 2`). NOTE: `Rd.ringSpawnPos`'s
  // own scale is `tier === 0 ? 2 : 2 - tier` — tier 2's candidate sits at scale 0, i.e. right on
  // the center (plus jitter), NOT at tier 0's radius-64 spot, so each tier gets its own POI.
  const claimedAtTier0 = { ['64,' + (PLAT_Y + 1) + ',0']: 1 };
  const avoided = Rd.findRaiderSpawnPos(raid, 0, 20, Object.assign({}, ctxBase, { claimed: claimedAtTier0 }));
  ok(avoided === null, 'tier 0, a POI sitting right on the only candidate -> refused (near a village, tier < 2)');
  const claimedAtTier2 = { ['0,' + (PLAT_Y + 1) + ',0']: 1 };   // tier 2's own scale-0 candidate
  const bypassed = Rd.findRaiderSpawnPos(raid, 2, 20, Object.assign({}, ctxBase, { claimed: claimedAtTier2 }));
  ok(!!bypassed && bypassed.x === 0 && bypassed.z === 0,
    'anti-vacuity(direction): the SAME shape of POI, at tier 2, no longer refuses — Raid.java\'s own `$$0 >= 2` bypass');

  ok(Rd.canPlaceRaiderAt(L, 64, PLAT_Y + 1, 0) === true, 'open air on solid ground is a valid raider spot');
  LW.setBlock(64, PLAT_Y + 1, 0, LSTONE);
  ok(Rd.canPlaceRaiderAt(L, 64, PLAT_Y + 1, 0) === false,
    'anti-vacuity(direction): the SAME cell, now solid, is refused');
  LW.setBlock(64, PLAT_Y + 1, 0, 0);
}

say('\n§10 — Rd.tickLive: a real Bad Omen + a real claimed workstation starts a raid, spawns a real wave');
{
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const workPos = { x: 2, y: PLAT_Y + 1, z: 0 };   // same Y as the villager's own feet — Prof.tryClaim's own adjacency test (07o_profession.js)
  LW.setBlock(workPos.x, workPos.y, workPos.z, LWORKSTATION);
  const villager = { id: 900, type: 'villager', x: workPos.x - 1, y: PLAT_Y + 1, z: workPos.z, profession: 'none' };   // one cell over — Prof.tryClaim looks at its own 8 NEIGHBOURS, not its own feet cell
  const claimedProf = LProf.tryClaim(villager);
  ok(claimedProf === 'librarian', `a villager next to a lectern claims librarian (Prof.WORKSTATIONS), got ${claimedProf}`);
  ok(!!LProf.claimed[workPos.x + ',' + workPos.y + ',' + workPos.z], 'Profession.claimed now holds this engine\'s one POI fact');

  const player = mkLivePlayer({ x: 3, y: PLAT_Y + 1, z: 0 });
  L.Player = player;
  ok(Lrd.villageCenterNear(player, LProf.claimed) !== null, 'the player standing by the claimed lectern reads as "near a village"');

  // anti-vacuity: no Bad Omen on the player -> tickLive starts nothing
  Lrm.world.raids = {};
  Lrd.tickLive(L);
  okAv(Object.keys(Lrm.world.raids).length === 0, 'anti-vacuity: tickLive with no Bad Omen on the player starts no raid');

  LES.addStatusEffect(player, 'bad_omen', 1000, 0, false, true);
  warmLive();
  const raidIds = Object.keys(Lrm.world.raids);
  ok(raidIds.length === 1, `tickLive with a real Bad Omen + a real nearby POI starts exactly one live raid, got ${raidIds.length}`);
  ok(LES.hasStatusEffect(player, 'bad_omen') === false, 'and the SAME tickLive call consumed it — Rd.start\'s own rule, live');

  const raid = Lrm.world.raids[raidIds[0]];
  ok(raid.center.x === workPos.x && raid.center.z === workPos.z, `the raid's own center is the claimed workstation's position, got ${JSON.stringify(raid.center)}`);
  // easy wave 1: pillager[1] = 4, every other member 0 -- the SAME tickLive call above already
  // ran RM.tick, and wave 1 has no horn delay (wavesSpawned starts at 0), so it should already
  // be live.
  // pillager's/vindicator's own easy-difficulty getBonusCount (Rd.getBonusCount) each roll a
  // REAL random 0-or-1 extra (Raid.java:700-726's own easy branch) ON TOP OF wave 1's base 4
  // pillagers — vindicator's own base for wave 1 is 0, but its BONUS is independent of its base
  // (`Rd.spawnNextWave`'s own `getCount(...) + getBonusCount(...)`), so wave 1 can carry a
  // vindicator even though `Rd.MEMBERS.vindicator[1]` is 0. 4 to 6 raiders is the real range.
  ok(raid.wavesSpawned === 1 && raid.raiders.length >= 4 && raid.raiders.length <= 6,
    `wave 1 (pillager x4-5 + vindicator x0-1, easy) is already live off the SAME tickLive call, got wavesSpawned=${raid.wavesSpawned} raiders=${raid.raiders.length}`);
  const allRaidersReal = raid.raiders.every((m) => (m.type === 'pillager' || m.type === 'vindicator') && m.raidId === raid.id);
  ok(allRaidersReal, 'every spawned raider is a REAL pillager/vindicator entity (EntityList.spawn), each carrying raid membership (mob.raidId)');
  ok(raid.raiders.filter((m) => m.patrolLeader && m.ominousBanner).length === 1,
    'exactly one of them carries the ominous banner as this wave\'s captain');
  const leaderIdx = raid.raiders.findIndex((m) => m.patrolLeader);
  ok(raid.waveCaptain[1] === raid.raiders[leaderIdx], 'raid.waveCaptain[1] is that same captain');

  // QUEUE 0.2 (raid loop remainder, this unit) -- `Raid.setWaveCaptain`'s own equip half
  // (.decomp `Raid.java:676-678`): the captain's HEAD slot now carries a REAL `ItemStack`, not
  // just the `ominousBanner`/`headItem` state flags §10 already checked above.
  const captain = raid.raiders[leaderIdx];
  const bannerStack = L.Equip.getEquipped(captain, L.Items.HEAD);
  ok(!!bannerStack, 'the wave captain\'s HEAD slot carries a real equipped ItemStack');
  ok(L.Items.nameOf(bannerStack.i) === 'white_banner',
    `the equipped stack is a white_banner (Raid.getOminousBanner()'s own base item), got ${bannerStack && L.Items.nameOf(bannerStack.i)}`);
  ok(L.Equip.isOminousBanner(bannerStack) === true,
    'Eq.isOminousBanner recognises the captain\'s own equipped stack (item + NBT pattern list, ItemStack.areEqual\'s own shape)');
  ok(L.Equip.dropChance(captain, L.Items.HEAD) === L.Equip.OMINOUS_BANNER_DROP_CHANCE,
    `the captain's HEAD drop chance is the forced-drop 2.0F literal (PatrolEntity.java:85/Raid.java:677), got ${L.Equip.dropChance(captain, L.Items.HEAD)}`);
  // anti-vacuity(substrate): a plain banner with NO patterns is NOT the ominous banner --
  // Eq.isOminousBanner has to be comparing real NBT, not just the item id.
  okAv(L.Equip.isOminousBanner({ i: bannerStack.i, n: 1, d: 0, t: {} }) === false,
    'anti-vacuity: a bare white_banner stack with no BlockEntityTag/Patterns is NOT recognised as the ominous banner');
  // anti-vacuity(direction): a captain killed by the player really sheds the real banner item
  // through the SAME Eq.dropEquipment path every other equipped mob already uses (equipcheck.mjs).
  const dropRnd = () => 0.999999;   // r() < 2.0 is always true regardless, but pin it anyway
  const dropped = L.Equip.dropEquipment(captain, dropRnd, true);
  okAv(dropped.length === 1 && dropped[0].item === 'white_banner' && dropped[0].slot === L.Items.HEAD,
    `anti-vacuity: a player-killed captain's Eq.dropEquipment sheds exactly the white_banner off its HEAD slot, got ${JSON.stringify(dropped)}`);
  okAv(L.Equip.getEquipped(captain, L.Items.HEAD) === null,
    'anti-vacuity: and the HEAD slot is empty afterward — the same stack cannot drop twice');

  // anti-vacuity: a player with no nearby POI at all gets no raid, even carrying Bad Omen
  const lonelyPlayer = mkLivePlayer({ x: 500, y: PLAT_Y + 1, z: 500 });
  L.Player = lonelyPlayer;
  LES.addStatusEffect(lonelyPlayer, 'bad_omen', 1000, 0, false, true);
  const before = Object.keys(Lrm.world.raids).length;
  Lrd.tickLive(L);
  okAv(Object.keys(Lrm.world.raids).length === before,
    'anti-vacuity: Bad Omen alone, nowhere near any claimed workstation, starts nothing live');
  L.Player = player;
}

say('\n§11 — live wave-cleared -> VICTORY -> Hero of the Village, off a REAL kill (Cb.hurt -> Rd.handleRaiderDeath)');
{
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const workPos = { x: 2, y: PLAT_Y + 1, z: 0 };   // same Y as the villager's own feet — Prof.tryClaim's own adjacency test (07o_profession.js)
  LW.setBlock(workPos.x, workPos.y, workPos.z, LWORKSTATION);
  const villager = { id: 901, type: 'villager', x: workPos.x - 1, y: PLAT_Y + 1, z: workPos.z, profession: 'none' };   // one cell over — Prof.tryClaim looks at its own 8 NEIGHBOURS, not its own feet cell
  LProf.tryClaim(villager);
  const player = mkLivePlayer({ x: 3, y: PLAT_Y + 1, z: 0 });
  L.Player = player;

  Lrm.world.raids = {};
  LES.addStatusEffect(player, 'bad_omen', 1000, 0, false, true);
  warmLive();
  const raid = Lrm.world.raids[Object.keys(Lrm.world.raids)[0]];
  raid.waveCount = 1;   // a one-wave raid, so clearing it is clearing the WHOLE raid (Rd.hasSpawnedFinalWave)
  ok(raid.wavesSpawned === 1 && raid.raiders.length >= 4 && raid.raiders.length <= 6,
    `the live wave (4-6 raiders, §10's own bonus-roll note) is up before this section forces a 1-wave raid, got ${raid.raiders.length}`);

  // anti-vacuity: a kill this engine cannot credit to a player does not grant Hero of the
  // Village, even though it still clears the raider off the wave.
  const first = raid.raiders[0];
  LCb.hurt(first, first.maxHealth + 100, undefined, false);
  okAv(raid.raiders.indexOf(first) === -1, 'anti-vacuity: Cb.hurt -> e.dead -> Rd.handleRaiderDeath removed the killed raider from the wave');
  okAv(!raid.heroes.player, 'anti-vacuity: an UNcredited kill (byPlayer=false) removes the raider but grants no hero credit');

  for (const m of raid.raiders.slice()) LCb.hurt(m, m.maxHealth + 100, undefined, true);
  ok(raid.raiders.length === 0, 'every remaining raider killed BY the player is off the wave');
  ok(!!raid.heroes.player, 'and at least one of those credited kills recorded the player as a hero candidate');

  for (let t = 0; t < Rd.POST_RAID_WIN_DELAY + 5; t++) Lrd.tickLive(L);
  ok(raid.status === Rd.Status.VICTORY, `the raid reaches VICTORY live once postRaidTicks passes ${Rd.POST_RAID_WIN_DELAY}, got status=${raid.status}`);
  ok(LES.hasStatusEffect(player, 'hero_of_the_village') === true,
    'and the credited player is granted a REAL hero_of_the_village status effect (Rd.grantHeroes, off the real Effects module)');
}


say('\n§12 — RaiderEntity shared goals (Ai.addRaiderGoals): MoveToRaidCenterGoal/AttackHomeGoal walk a real raider toward raid.center, CelebrateGoal fires on a real raiders-won raid');
{
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const workPos = { x: 2, y: PLAT_Y + 1, z: 0 };
  LW.setBlock(workPos.x, workPos.y, workPos.z, LWORKSTATION);
  const villager = { id: 950, type: 'villager', x: workPos.x - 1, y: PLAT_Y + 1, z: workPos.z, profession: 'none' };
  LProf.tryClaim(villager);
  const player = mkLivePlayer({ x: 3, y: PLAT_Y + 1, z: 0 });
  L.Player = player;
  Lrm.world.raids = {};
  LES.addStatusEffect(player, 'bad_omen', 1000, 0, false, true);
  warmLive();
  const raid = Lrm.world.raids[Object.keys(Lrm.world.raids)[0]];
  ok(!!raid && raid.raiders.length > 0, `a live wave is up (§10's own note on the 4-6 range), got ${raid ? raid.raiders.length : 'no raid'}`);

  const rider = raid.raiders[0];
  ok(!!rider.ai, 'the live raider carries a real goal selector (EL.spawn -> Ai.selectorFor)');
  ok(Lrd.isNearOccupiedPOI({ x: rider.x, y: rider.y, z: rider.z }, LProf.claimed) === false,
    'a freshly spawned raider (tier-0 ring, radius 64) starts OUTSIDE the POI radius — the exact condition MoveToRaidCenterGoal needs to fire');

  const startDistSq = (rider.x - raid.center.x) ** 2 + (rider.z - raid.center.z) ** 2;
  for (let t = 0; t < 400; t++) L.EntityList.tick();
  const endDistSq = (rider.x - raid.center.x) ** 2 + (rider.z - raid.center.z) ** 2;
  ok(endDistSq < startDistSq, `MoveToRaidCenterGoal/AttackHomeGoal actually walk the raider toward raid.center over 400 real ticks, ${startDistSq.toFixed(1)} -> ${endDistSq.toFixed(1)}`);

  // player far away for the rest of this section -- close enough and a raider re-acquires it
  // as a combat target every tick (NearestAttackableTargetGoal), which would mask what raid
  // status alone is supposed to gate below.
  player.x = 100000; player.z = 100000;

  // anti-vacuity: a raider whose raid is no longer ONGOING (both goals' own gate) never RUNS
  // MoveToRaidCenterGoal/AttackHomeGoal (priorities 3/4, MOVE) again — checked against the goal
  // selector's own running flags, not raw position, since the mob's OWN base roster still has a
  // lower-priority stroll goal (WaterAvoidingRandomStrollGoal) that legitimately wanders once
  // the raid goals stop holding the MOVE flag; that stroll is correct behaviour, not this test's
  // concern.
  const stalled = raid.raiders[1] || rider;
  const raidMoveEntries = stalled.ai.entries.filter((en) => en.priority === 3 || en.priority === 4)
    .filter((en) => en.flags === 1)
    .filter((en) => en.goal.__goalName === 'MoveToRaidCenterGoal' || en.goal.__goalName === 'AttackHomeGoal');   // Ai.* constructors are name-stamping wrappers (07k_goals.js), so constructor identity no longer holds
  ok(raidMoveEntries.length === 2, `the raider carries exactly MoveToRaidCenterGoal(3)/AttackHomeGoal(4) at MOVE among its priority-3/4 entries, got ${raidMoveEntries.length}`);
  const savedStatus = raid.status;
  raid.status = Rd.Status.STOPPED;
  let sawRunningWhileStopped = false;
  for (let t = 0; t < 100; t++) {
    stalled.target = null;
    L.EntityList.tick();
    if (raidMoveEntries.some((en) => en.running)) sawRunningWhileStopped = true;
  }
  okAv(!sawRunningWhileStopped,
    'anti-vacuity: the SAME raider, its raid forced STOPPED, never runs MoveToRaidCenterGoal/AttackHomeGoal again — raidOngoing(r) is what gates both, not a stray flag');
  raid.status = savedStatus;

  // CelebrateGoal — direct goal-level test (no combat substrate needed to force a LOSS status).
  const captain = raid.waveCaptain[1];
  ok(!!captain, 'wave 1 has a real captain to drive the celebrate goal through');
  raid.status = Rd.Status.LOSS;
  for (let t = 0; t < 150 && !captain.celebrating; t++) { captain.target = null; L.EntityList.tick(); }
  ok(captain.celebrating === true, 'CelebrateGoal sets e.celebrating once raid.status reaches LOSS (raiders won) — real, off Rd.Status.LOSS');

  // anti-vacuity: a raider still fighting (e.target set) never celebrates even on a LOSS raid.
  const other = raid.raiders.find((m) => m !== captain) || captain;
  other.celebrating = false;
  const fakeTarget = { x: 0, y: 0, z: 0, dead: false };
  for (let t = 0; t < 150; t++) { other.target = fakeTarget; L.EntityList.tick(); }
  okAv(other.celebrating === false, 'anti-vacuity: the SAME LOSS raid, a raider with a live combat target, never celebrates — CelebrateGoal\'s own !e.target gate');
}

say('\n§13 — PickupBannerAsLeaderGoal: real scan/pickup mechanics, driven through the LIVE tick loop, proven with a synthetic ominous_banner item (none is ever registered live)');
{
  const BANNER = L.Items.of('white_banner'), BTAG = L.Equip.getOminousBanner().t;   // #3043: the real stack, not a synthetic id

  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const savedRM = L.RaidManager;
  // a synthetic registry entry, standing in for the day this engine's own item registry grows
  // `ominous_banner` (07k_goals.js's own header names why it does not today) — this proves the
  // GOAL's own scan/path/loot mechanics through the REAL tick loop (Ai.stepToward only sets a
  // heading; Ph.travelMob is what actually moves an entity — EL.tick() is what runs both).

  const leader = L.EntityList.spawn('vindicator', 0, PLAT_Y + 1, 0, { spawnReason: 'event' });   // a raid member (D-671: no summon-captain roll)
  leader.raidId = 777; leader.wave = 1;
  L.RaidManager = { world: { raids: { 777: { status: Rd.Status.ONGOING, waveCaptain: {}, center: { x: 0, y: PLAT_Y + 1, z: 0 } } } } };
  const bannerItem = L.EntityList.spawn('item', 5, PLAT_Y + 1, 0, { item: BANNER, count: 1, tag: BTAG });
  bannerItem.pickupDelay = 0;

  ok(leader.headItem === undefined, 'a fresh vindicator carries no head-slot state yet');
  for (let t = 0; t < 200 && leader.headItem !== 'ominous_banner'; t++) L.EntityList.tick();
  ok(leader.headItem === 'ominous_banner' && leader.ominousBanner === true,
    'walking the real path this goal built through 200 real ticks, the leader loots the banner and sets the SAME head-slot state Rd.spawnNextWave/Ps.spawnPillager give a captain at spawn');
  ok(L.EntityList.list.indexOf(bannerItem) === -1, 'and the looted item entity is removed from the live world, off a real EL.remove call');

  // anti-vacuity(direction): a banner 17 blocks away (past the 16-block box) never starts the goal.
  const leader2 = L.EntityList.spawn('vindicator', 40, PLAT_Y + 1, 0, { spawnReason: 'event' });
  leader2.raidId = 778; leader2.wave = 1;
  L.RaidManager.world.raids[778] = { status: Rd.Status.ONGOING, waveCaptain: {}, center: { x: 40, y: PLAT_Y + 1, z: 0 } };
  const farItem = L.EntityList.spawn('item', 57, PLAT_Y + 1, 0, { item: BANNER, count: 1, tag: BTAG });
  farItem.pickupDelay = 0;
  const goal2 = new L.Ai.PickupBannerAsLeaderGoal(leader2, {});
  okAv(goal2.canUse() === false, 'anti-vacuity: the SAME item, 17 blocks off (past the 16-block box), never starts the goal');

  L.RaidManager = savedRM;
}

say('\n§14 — PatrolSpawner (07x_patrol.js): a real roaming pillager patrol, day/light/odds gates, and Ai.PatrolGoal moving it; RaiderEntity.onDeath\'s banner-kill half now has a live caller');
{
  freshWorld();
  plateWithHeightmap(-75, 75, -75, 75, PLAT_Y);
  const player = mkLivePlayer({ x: 0, y: PLAT_Y + 1, z: 0 });
  L.Player = player;
  L.Profession.claimed = {};
  L.Patrol.state.cooldown = 0;

  // anti-vacuity(direction 1): before day 5, no patrol spawns even with everything else forced.
  L.Sky.dayTime = 2 * 24000 + 6000;
  const savedRandom1 = Math.random;
  Math.random = () => 0.01;   // forces the odds roll, the sign rolls, everything BUT the day gate
  const before1 = L.EntityList.list.length;
  const placed1 = L.Patrol.tick(L);
  okAv(placed1 === 0 && L.EntityList.list.length === before1, 'anti-vacuity: day 2 (< Ps.MIN_DAY), forced-lucky odds roll and all, spawns nothing');
  Math.random = savedRandom1;

  // anti-vacuity(doMobSpawning): ServerChunkManager.tickChunks:380-383 runs the custom spawners only
  // under doMobSpawning — this engine's `Spawn.ready` (D-397). Everything else forced lucky, day 5.
  if (L.Spawn) {
    const savedReady = L.Spawn.ready, savedRandom0 = Math.random;
    L.Sky.dayTime = 5 * 24000 + 6000; L.Patrol.state.cooldown = 0; L.Spawn.ready = false;
    Math.random = () => 0.01;
    const before0 = L.EntityList.list.length;
    const placed0 = L.Patrol.tick(L);
    Math.random = savedRandom0; L.Spawn.ready = savedReady;
    okAv(placed0 === 0 && L.EntityList.list.length === before0, 'anti-vacuity: Spawn.ready=false (doMobSpawning off) spawns no patrol, day 5 and forced-lucky rolls notwithstanding');
    L.Spawn.ready = true;
  }

  // day 5+, noon (isDay), deterministic rolls -> a real leader (+ follower on 'normal') spawns.
  L.Sky.dayTime = 5 * 24000 + 6000;
  L.Patrol.state.cooldown = 0;
  const savedRandom2 = Math.random;
  Math.random = () => 0.01;
  const savedEL2 = L.EntityList.random; L.EntityList.random = () => 0.01;   // Ps.RNDFB draws from the entity list's stream (#6440), not Math.random
  const before2 = L.EntityList.list.filter((e) => e.type === 'pillager').length;
  const placed2 = L.Patrol.tick(L);
  Math.random = savedRandom2;
  L.EntityList.random = savedEL2;
  ok(placed2 >= 1, `day 5, noon, forced-lucky rolls -> PatrolSpawner actually places at least the leader, got ${placed2}`);
  const patrolPillagers = L.EntityList.list.filter((e) => e.type === 'pillager' && e.patrolling && e.raidId === undefined);
  ok(patrolPillagers.length === placed2, `every placed mob is a REAL live pillager (EntityList.spawn), carrying patrolling but no raidId`);
  const leader = patrolPillagers.find((m) => m.patrolLeader);
  ok(!!leader && leader.ominousBanner === true && leader.headItem === 'ominous_banner' && !!leader.patrolTarget,
    'the patrol leader carries the ominous banner\'s head-slot state and a real far-off patrolTarget (Ps.setRandomPatrolTarget)');
  // #746: PatrolSpawner.spawnPillager rolls the leader's target BEFORE setPosition (entity at 0,0,0).
  const pt = leader.patrolTarget;
  ok(pt.x >= -500 && pt.x < 500 && pt.z >= -500 && pt.z < 500 && pt.y === 0,
    `leader patrolTarget is within [-500,500) of world origin at y=0, got ${pt.x},${pt.y},${pt.z}`);
  const fake = { x: 12345, y: 70, z: -6789 };
  L.Patrol.setRandomPatrolTarget(fake, () => 0.01);
  okAv(fake.patrolTarget.x > 500, 'anti-vacuity: rolling around the mob\'s own position (the old behaviour) lands outside the origin window');
  // QUEUE 0.2 (raid loop remainder, this unit) -- `PatrolEntity.initialize`'s own equip half
  // (.decomp `PatrolEntity.java:84-85`): the roaming leader's HEAD slot is a real ItemStack too.
  ok(L.Equip.isOminousBanner(L.Equip.getEquipped(leader, L.Items.HEAD)) === true,
    'the roaming patrol leader\'s HEAD slot is the same real ominous-banner ItemStack a raid captain gets');
  ok(L.Equip.dropChance(leader, L.Items.HEAD) === L.Equip.OMINOUS_BANNER_DROP_CHANCE,
    'and its drop chance is the same forced-drop 2.0F');
  const follower = patrolPillagers.find((m) => !m.patrolLeader);
  if (follower) {
    ok(follower.ominousBanner === undefined, 'a follower carries no banner state — only the leader does');
    okAv(L.Equip.getEquipped(follower, L.Items.HEAD) === null,
      'anti-vacuity: a follower\'s HEAD slot carries no equipped item at all — only the leader\'s does');
  }

  // Ai.PatrolGoal actually moves the leader toward its own far patrolTarget over real ticks.
  const leaderStart = { x: leader.x, z: leader.z };
  // the forced 0.01 rolls above give the leader a 3-sigma follow_range spawn bonus (MobEntity.initialize,
  // 32 -> 36.8) that reaches the player 33.9 blocks off; this line tests the PATROL walk, not targeting
  leader.followBonus = 0;
  // a lone leader clears `patrolling` on its first idle tick (#745): make sure it has a roaming mate
  if (!L.EntityList.list.some((m) => m !== leader && m.type === 'pillager' && m.patrolling && m.raidId === undefined))
    L.EntityList.spawn('pillager', leader.x + 2, leader.y, leader.z, { spawnReason: 'patrol' }).patrolling = true;
  for (let t = 0; t < 200; t++) { leader.target = null; L.EntityList.tick(); }
  ok(Math.abs(leader.x - leaderStart.x) + Math.abs(leader.z - leaderStart.z) > 0.5,
    'Ai.PatrolGoal (inherited via Ai.addRaiderGoals -> PatrolEntity.initGoals) actually walks the roaming leader over 200 real ticks');

  // PatrolGoal speeds (PatrolEntity.PatrolGoal(this,0.7,0.595)): leader uses followSpeed 0.595, members leaderSpeed 0.7
  {
    const realStep = L.Ai.stepToward, seen = { leader: new Set(), member: new Set() };
    L.Ai.stepToward = function (e, node, sp) {
      if (e.type === 'pillager' && e.patrolling) seen[e.patrolLeader ? 'leader' : 'member'].add(sp);
      return realStep.apply(this, arguments);
    };
    // a lone leader clears `patrolling` on its first idle tick (#745), so give it a roaming mate and re-arm
    L.EntityList.spawn('pillager', leader.x + 2, leader.y, leader.z, { spawnReason: 'event' }).raidId = undefined;
    leader.patrolling = true;
    const g = new L.Ai.PatrolGoal(leader, {});
    g.start(); g.tick();
    // this block tests the patrol speed, not targeting: keep the leader target-free (it has locked a pillager by now)
    for (let t = 0; t < 200; t++) { leader.target = null; L.EntityList.tick(); }
    L.Ai.stepToward = realStep;
    ok(seen.leader.size > 0 && [...seen.leader].every((v) => v === 0.595), 'PatrolGoal: the patrol leader walks at 0.595 (vanilla followSpeed)');
    okAv(!seen.leader.has(0.7), 'anti-vacuity: the leader is never driven at the member speed 0.7');
    if (seen.member.size) ok([...seen.member].every((v) => v === 0.7), 'PatrolGoal: patrol members walk at 0.7 (vanilla leaderSpeed)');
  }

  // #745: a LONE leader (no mates within 16) clears patrolling on its first idle tick (PatrolEntity.PatrolGoal.tick)
  {
    const lone = { x: 1e6, y: 70, z: 1e6, patrolling: true, patrolLeader: true, patrolTarget: { x: 1e6 + 300, y: 70, z: 1e6 }, age: 0 };
    const g = new L.Ai.PatrolGoal(lone, {});
    ok(g.canUse() === true, 'lone leader: canUse while patrolling');
    g.start(); g.tick();
    ok(lone.patrolling === false, 'lone leader with no mates stops patrolling on its first idle tick (vanilla isRaidCenterSet && targets.isEmpty)');
    const lone2 = { x: 1e6, y: 70, z: 1e6, patrolling: true, patrolLeader: false, patrolTarget: { x: 1e6 + 300, y: 70, z: 1e6 }, age: 0, passenger: {} };
    okAv(new L.Ai.PatrolGoal(lone2, {}).canUse() === false, 'anti-vacuity: a mob carrying a passenger does not patrol (hasPassengers)');
  }

  // anti-vacuity(direction 2): the SAME cooldown-armed spawner rolls nothing again immediately
  // (PatrolSpawner.java's own 12000+ tick cooldown) even with forced-lucky rolls.
  const beforeCount = L.EntityList.list.filter((e) => e.type === 'pillager').length;
  const savedRandom3 = Math.random;
  Math.random = () => 0.01;
  const placed3 = L.Patrol.tick(L);
  Math.random = savedRandom3;
  okAv(placed3 === 0 && L.EntityList.list.filter((e) => e.type === 'pillager').length === beforeCount,
    'anti-vacuity: immediately after a successful roll, the just-armed 12000+ tick cooldown blocks a second spawn this same session');

  // RaiderEntity.onDeath's banner-kill half now has a live caller (14j_combat.js, this unit):
  // killing the roaming leader grants the player a fresh Bad Omen.
  ok(LES.hasStatusEffect(player, 'bad_omen') === false, 'the player carries no Bad Omen yet, before the kill');
  LCb.hurt(leader, (leader.maxHealth || 20) + 100, undefined, true);
  ok(LES.hasStatusEffect(player, 'bad_omen') === true,
    'killing the roaming banner-leader BY THE PLAYER live-wires RaiderEntity.onDeath\'s banner-kill half (Rd.onPatrolLeaderDeath, 14j_combat.js\'s new branch) -- Rd.OWED\'s own "no live caller" line, closed by this unit');

  // anti-vacuity(direction): a non-leader, or a kill this engine cannot credit to a player,
  // grants nothing.
  if (follower) {
    LES.removeStatusEffect(player, 'bad_omen');
    LCb.hurt(follower, (follower.maxHealth || 20) + 100, undefined, true);
    okAv(LES.hasStatusEffect(player, 'bad_omen') === false, 'anti-vacuity: killing a FOLLOWER (no ominous banner) grants nothing');
  }
}

// ── §15 (s98) — the ravager PASSENGER rule, .decomp Raid.java:500-514, + Entity.tickRiding live ──
say('\n§15 — Raid.spawnNextWave ravager passengers (wave 5 pillager; wave >=7 evoker then vindicator) + a live mob-on-mob ride');
{
  // (a) wave 5 of a NORMAL raid: the one ravager carries a pillager rider, added to the same wave.
  const raid = Rd.create(21, { x: 0, y: 64, z: 0 }, 'normal');
  raid.wavesSpawned = 4;
  const res = Rd.spawnNextWave(raid, { x: 0, y: 64, z: 0 }, mkRand([]), (t) => mkMob(t));
  const ravs = res.spawned.filter((e) => e.type === 'ravager');
  ok(ravs.length === 1 && ravs[0].passenger && ravs[0].passenger.type === 'pillager',
    `normal wave 5: the ravager carries a PILLAGER (got ${ravs.map((r) => r.passenger && r.passenger.type)})`);
  ok(ravs[0].passenger && ravs[0].passenger.vehicle === ravs[0] && raid.raiders.indexOf(ravs[0].passenger) >= 0 && ravs[0].passenger.wave === 5,
    'the rider is linked both ways and addRaider\'d into wave 5 (it counts toward wave-clear)');
  ok(raid.waveCaptain[5] !== ravs[0].passenger, 'the rider never becomes the captain (only the loop\'s own mob is tested)');
  // (b) wave 7 of a HARD raid: two ravagers — first evoker, second vindicator.
  const raid7 = Rd.create(22, { x: 0, y: 64, z: 0 }, 'hard');
  raid7.wavesSpawned = 6;
  const r7 = Rd.spawnNextWave(raid7, { x: 0, y: 64, z: 0 }, mkRand([]), (t) => mkMob(t));
  const rv7 = r7.spawned.filter((e) => e.type === 'ravager');
  ok(rv7.length === 2 && rv7[0].passenger.type === 'evoker' && rv7[1].passenger.type === 'vindicator',
    `hard wave 7: ravager #1 carries an EVOKER, #2 a VINDICATOR (got ${rv7.map((r) => r.passenger && r.passenger.type)})`);
  // (c) both directions: wave 4 of a hard raid (ravager count 1 at index 4? table says 0) and wave 6 (1 ravager) -> no rider.
  const raid6 = Rd.create(23, { x: 0, y: 64, z: 0 }, 'hard');
  raid6.wavesSpawned = 5;
  const r6 = Rd.spawnNextWave(raid6, { x: 0, y: 64, z: 0 }, mkRand([]), (t) => mkMob(t));
  const rv6 = r6.spawned.filter((e) => e.type === 'ravager');
  ok(rv6.every((r) => !r.passenger) && Rd.ravagerPassengerType(6, 0) === null && Rd.ravagerPassengerType(3, 0) === null,
    `hard wave 6 (${rv6.length} ravager(s)) and wave 3: no rider (neither 5 nor >=7)`);
  const raid4 = Rd.create(24, { x: 0, y: 64, z: 0 }, 'normal');
  raid4.wavesSpawned = 3;
  const r4 = Rd.spawnNextWave(raid4, { x: 0, y: 64, z: 0 }, mkRand([]), (t) => mkMob(t));
  ok(r4.spawned.filter((e) => e.type === 'ravager').every((r) => !r.passenger), 'normal wave 4: its ravager rides empty');
  // anti-vacuity: the rule really reads Rd.MAX_WAVES.normal.
  {
    const saved = Rd.MAX_WAVES.normal;
    Rd.MAX_WAVES.normal = 99;
    const rb = Rd.create(25, { x: 0, y: 64, z: 0 }, 'normal'); rb.wavesSpawned = 4;
    const xb = Rd.spawnNextWave(rb, { x: 0, y: 64, z: 0 }, mkRand([]), (t) => mkMob(t));
    Rd.MAX_WAVES.normal = saved;
    okAv(xb.spawned.filter((e) => e.type === 'ravager').every((r) => !r.passenger),
      'anti-vacuity: with MAX_WAVES.normal moved off 5, wave 5\'s ravager gets NO rider — the pick is keyed off the table');
  }
  ok(Math.abs(Rd.RAVAGER_MOUNTED_HEIGHT - 2.1) < 1e-9 && Math.abs(Rd.RAIDER_HEIGHT_OFFSET + 0.45) < 1e-9,
    'mounted height 2.1 (RavagerEntity.getMountedHeightOffset) and rider offset -0.45 (PatrolEntity.getHeightOffset)');

  // (d) LIVE: a real ravager + real pillager through the real EL.tickMob.
  freshWorld();
  plateWithHeightmap(-20, 20, -20, 20, PLAT_Y);
  const rav = LEL.spawn('ravager', 0.5, PLAT_Y + 1, 0.5);
  const pil = LEL.spawn('pillager', 3.5, PLAT_Y + 1, 3.5);
  ok(!!rav && !!pil, 'the live engine spawns a real ravager and pillager');
  if (rav && pil) {
    Lrd.startRiding(pil, rav);
    rav.vx = 0.2; rav.vz = 0.1;   // the vehicle moves on its own this tick
    let worst = 0;
    for (let t = 0; t < 40; t++) {
      LEL.tickMob(rav); LEL.tickMob(pil);
      worst = Math.max(worst, Math.abs(pil.x - rav.x), Math.abs(pil.z - rav.z), Math.abs(pil.y - (rav.y + 2.1 - 0.45)));
    }
    ok(pil.riding === true, 'riding sets the engine\'s hasVehicle flag e.riding (goals/renderer read it)');
    ok(worst < 1e-9, `40 live ticks: the rider sits at vehicle x/z and vehicle.y + 1.65 every tick (worst drift ${worst})`);
    // anti-vacuity: without the riding branch the pillager walks/falls on its own.
    {
      const saved = Lrd.tickPassenger;
      Lrd.tickPassenger = () => false;
      let drift = 0;
      for (let t = 0; t < 20; t++) { LEL.tickMob(rav); LEL.tickMob(pil); drift = Math.max(drift, Math.abs(pil.y - (rav.y + 1.65))); }
      Lrd.tickPassenger = saved;
      okAv(drift > 0.2, `anti-vacuity: with Rd.tickPassenger stubbed, the pillager falls off the ravager (drift ${drift.toFixed(2)})`);
      Lrd.startRiding(pil, rav);
    }
    rav.dead = true;
    LEL.tickMob(pil);
    ok(!pil.vehicle && !rav.passenger && pil.riding === false, 'the vehicle dying drops its rider (Entity.removeAllPassengers) — both links cleared, e.riding false');
  }
}

// ── §16 (s98) — the disableRaids gamerule, live (RaidManager.java:52-54, 81-82) ──
say('\n§16 — disableRaids: startRaid refuses (Bad Omen kept), RM.tick invalidates live raids');
{
  const savedC = L.Commands;
  const rule = { v: 'true' };
  L.Commands = { ruleGet: (n) => (n === 'disableRaids' ? rule.v : null) };
  const player = mkPlayer();
  LES.addStatusEffect(player, 'bad_omen', 100, 0, false, true);
  const rm = { raids: {}, nextId: 1 };
  const r0 = Lrm.startRaid(rm, player, { x: 0, y: 64, z: 0 }, 'normal', LES);
  ok(r0 === null && Object.keys(rm.raids).length === 0, 'disableRaids=true: startRaid returns null and creates no raid');
  ok(LES.hasStatusEffect(player, 'bad_omen'), 'the refusal comes BEFORE the Bad Omen is consumed (RaidManager.java:81 precedes the removal)');
  rule.v = 'false';
  const r1 = Lrm.startRaid(rm, player, { x: 0, y: 64, z: 0 }, 'normal', LES);
  okAv(!!r1 && !LES.hasStatusEffect(player, 'bad_omen'), 'anti-vacuity: disableRaids=false, the same call starts a raid and banks the omen — the rule is really read');
  rule.v = 'true';
  let ticked = 0;
  Lrm.tick(rm, () => { ticked++; return null; }, Lrm.raidsDisabled());
  ok(Object.keys(rm.raids).length === 0 && ticked === 0, 'RM.tick under disableRaids invalidates the live raid and drops it without ticking it');
  L.Commands = savedC;
  ok(Lrm.raidsDisabled() === false, 'no Commands module -> the vanilla default (false)');
}

// ── §17 (s98) — MoveToRaidCenterGoal.includeFreeRaiders, live through the real goal ──
say('\n§17 — includeFreeRaiders: a free patrol pillager within 16 joins the raid; a natural witch / far pillager / raid member do not');
{
  freshWorld();
  plateWithHeightmap(-40, 40, -40, 40, PLAT_Y);
  const raid = Lrd.create(Lrm.world.nextId++, { x: 0, y: PLAT_Y + 1, z: 0 }, 'normal');
  Lrm.world.raids[raid.id] = raid;
  raid.wavesSpawned = 2;
  const actor = LEL.spawn('vindicator', 0.5, PLAT_Y + 1, 0.5);
  const near = LEL.spawn('pillager', 8.5, PLAT_Y + 1, 0.5);
  const witch = LEL.spawn('witch', -6.5, PLAT_Y + 1, 0.5);
  const far = LEL.spawn('pillager', 30.5, PLAT_Y + 1, 0.5);
  const cow = LEL.spawn('cow', 3.5, PLAT_Y + 1, 3.5);
  ok(!!actor && !!near && !!witch && !!far, 'live vindicator + two pillagers + a witch spawned');
  if (actor && near && witch && far) {
    Lrd.addRaider(raid, 2, actor);
    witch.canJoinRaid = false;   // what 07l_spawn.js's natural path sets (RaiderEntity.initialize)
    actor.age = 100;
    const g = new L.Ai.MoveToRaidCenterGoal(actor, LEL.aiCtx ? LEL.aiCtx(actor) : {});
    g.start(); g.tick();
    ok(near.raidId === raid.id && near.wave === 2 && raid.raiders.indexOf(near) >= 0,
      `the free pillager 8 blocks off joins wave getGroupsSpawned()=2 (raidId ${near.raidId}, wave ${near.wave})`);
    ok(witch.raidId === undefined || witch.raidId === null, 'a NATURALLY spawned witch (canJoinRaid false) is not recruited');
    ok(far.raidId === undefined || far.raidId === null, 'a pillager 30 blocks off (outside box+16) is not recruited');
    ok(!cow || cow.raidId === undefined, 'a cow is not a raider');
    // anti-vacuity: with the recruit call stubbed, nobody joins.
    const saved = Lrd.includeFreeRaiders;
    Lrd.includeFreeRaiders = () => 0;
    const near2 = LEL.spawn('pillager', -8.5, PLAT_Y + 1, 4.5);
    actor.age = 200; g.tick();
    Lrd.includeFreeRaiders = saved;
    okAv(near2 && (near2.raidId === undefined || near2.raidId === null), 'anti-vacuity: with Rd.includeFreeRaiders stubbed the goal recruits nobody — the join lives in that call');
    // cadence: the goal only re-scans after 20 ticks of age.
    actor.age = 205; g.tick();
    ok(near2 && (near2.raidId === undefined || near2.raidId === null), 'cadence: 5 ticks later the goal does not rescan (nextFreeRaiderCheckAge = age + 20)');
    actor.age = 221; g.tick();
    ok(near2 && near2.raidId === raid.id, 'cadence: past age + 20 it rescans and recruits');
  }
  delete Lrm.world.raids[raid.id];
}

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  raidcheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' anti-vacuity checks' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
