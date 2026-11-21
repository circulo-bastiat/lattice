#!/usr/bin/env node
// runkb.mjs — the referee's KNOCKBACK runner (infra W, 25 Sept 2026). Scenarios: kbscen.mjs.
// Golden -> <referee dir>/golden/knockback.json. Own port 25661 + rcon 26661 + work dir.
//
//   node tools/referee/runkb.mjs             both directions
//   node tools/referee/runkb.mjs --only=a    just (A) mob-hits-bot
//   node tools/referee/runkb.mjs --only=b    just (B) bot-hits-mob
//
// (A) mob hits bot: `growbot.mjs`'s new `captureVelocity` option decodes the REAL Set Entity
// Velocity packet (0x4f, protocol 758) the server sends the bot right after the hit — the same
// packet a real client uses to know it got knocked back — never a re-derivation from Motion NBT
// (a PLAYER's own Motion is not vanilla's server-side source of truth for its rendered knockback,
// the packet is: `ServerPlayerEntity.velocityDirty` -> `EntityVelocityUpdateS2CPacket`, .decomp
// ServerPlayerEntity.java).
//
// (B) bot hits mob: the bot's own network Interact Entity (0x0d, type 1 = Attack) packet, the
// exact packet a real client's left-click sends (`growbot.mjs`'s new `attack()`), then a
// DATAPACK TICK FUNCTION (copied from the sibling chase pack, `runchase.mjs`'s own header) that
// appends the mob's `Motion` to storage EVERY TICK, starting a few ticks before the attack packet
// is even sent and running LOG_TICKS ticks past it -- tick-exact, not a `sleep()` guess. Which
// logged tick is "the tick of the hit" is found from the data itself (the first tick whose
// horizontal |Motion| jumps well above the mob's own AI-wander baseline, `kbrefcheck.mjs`'s
// `findHitTick`), not assumed from wall-clock timing -- the attack packet and the RCON commands
// that arm the logger travel two independent connections, so which server tick the hit actually
// lands on is never guaranteed by construction, only recoverable from the logged sequence.
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { REPS, OFFSET, Y, BOT_ARMOR, BOT_ARMOR_TIERS, ATTACKERS, WEAPONS, TARGETS } from './kbscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBUG = !!process.env.MCLITE_KB_DEBUG;
const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const doA = !onlyArg || onlyArg === 'a';
const doB = !onlyArg || onlyArg === 'b';
const REPS_OVERRIDE = process.env.MCLITE_KB_REPS ? parseInt(process.env.MCLITE_KB_REPS, 10) : REPS;
// Part C (infra W, 25 Sept 2026): hoglin/zoglin need a real SAMPLE (KS test, kbrefcheck.mjs), not
// one point -- `atk.repsA` (kbscen.mjs) overrides REPS_OVERRIDE for just those two attackers.
// MCLITE_KB_REPS_HG lets a dev run shrink that sample for a quick local pass without touching the
// other attackers' own REPS_OVERRIDE.
const REPS_HG_OVERRIDE = process.env.MCLITE_KB_REPS_HG ? parseInt(process.env.MCLITE_KB_REPS_HG, 10) : null;
const PORT = process.env.MCLITE_KB_PORT ? parseInt(process.env.MCLITE_KB_PORT, 10) : 25661;
const RCON_PORT = process.env.MCLITE_KB_RCONPORT ? parseInt(process.env.MCLITE_KB_RCONPORT, 10) : 26661;
const LOG_TICKS = 20; // datapack-logged ticks per B rep: a settle margin before the hit + decay tail after it

// same triple-parser as runchase.mjs's `parsePosList` (copied, not imported -- this pack's own
// datapack/log shape must not silently drift if the chase pack's ever changes), for a
// `data get storage ... log` reply holding a list of [x,y,z] Motion doubles.
function parseVecList(reply) {
  const nums = (reply.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?d/g) || []).map((q) => parseFloat(q));
  const out = [];
  for (let i = 0; i + 2 < nums.length; i += 3) out.push([nums[i], nums[i + 1], nums[i + 2]]);
  return out;
}

async function main() {
  const workDir = process.env.MCLITE_KB_WORKDIR || join(homedir(), '.mclite-referee-kb');
  rmSync(join(workDir, 'world'), { recursive: true, force: true }); // clean world every run (runmelee's own reasoning)
  // datapack: tick function logs the tagged target's Motion into `mclite:kb` storage every tick
  // (runchase.mjs's own pattern, copied) -- gated by `#run`/`#t` scoreboard, reset every rep.
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitekb');
  const fdir = join(dp, 'data', 'mclitekb', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee knockback' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitekb:tick'] }));
  writeFileSync(join(fdir, 'log.mcfunction'), 'data modify storage mclite:kb log append from entity @e[tag=refkbb,limit=1] Motion\n');
  // one round trip to arm the logger (clear storage, zero the tick counter, start the gate) --
  // NOT three separate RCON commands: the mob keeps its own AI (see the settle-wait comment
  // below), so every extra RCON round trip before `bot.attack()` is more real time for it to
  // wander out of the fixed OFFSET reach before the swing lands (found empirically: three
  // separate arm commands let plain zombies -- unlike the slower ravager -- walk out of range).
  writeFileSync(join(fdir, 'arm.mcfunction'),
    ['data modify storage mclite:kb log set value []', 'scoreboard players set #t mc 0', 'scoreboard players set #run mc 1'].join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'),
    ['execute if score #run mc matches 1 if score #t mc matches ..' + (LOG_TICKS - 1) + ' run function mclitekb:log',
     'execute if score #run mc matches 1 run scoreboard players add #t mc 1'].join('\n') + '\n');
  const server = await startServer({ workDir, port: PORT, rconPort: RCON_PORT, xmx: '1536M' });
  const t0 = Date.now();
  const casesA = {}, casesB = {}, notes = [];

  let rcon, bot;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false',
      'forceload add -8 -8 8 8', 'difficulty normal', 'scoreboard objectives add mc dummy',
      'scoreboard players set #run mc 0']) await C(c);
    {
      const probe = await C('data modify storage mclite:kb log set value []');
      if (/Unknown|error/i.test(probe)) notes.push(`datapack storage probe: ${probe.trim()}`);
    }

    bot = await connectFakePlayer({ port: server.port, name: 'kb0', captureVelocity: true });
    await C('gamemode survival kb0');
    for (let attempt = 1; bot.entityId === null && attempt < 40; attempt++) await sleep(100);
    if (bot.entityId === null) notes.push('bot never learned its own entity id from Join Game (0x26) -- (A) cannot be captured');
    // ⚠ (B ONLY) `growbot`'s Spawn Living Entity capture on one long-lived connection eventually
    // stops delivering fresh ids at all (found empirically running this pack for real -- happens
    // at a different case each run, never recovers on its own even after several kill+re-summon
    // retries, so it is a stuck connection-level state, not an occasional dropped packet; the
    // actual cause is unlocated this pass, `still_owed`). Reconnecting throws the stuck state away
    // -- cheap (an ordinary login), and each (B) key gets its own fresh connection below.
    async function reconnectBot() {
      try { bot.close(); } catch { /* already gone */ }
      bot = await connectFakePlayer({ port: server.port, name: 'kb0', captureVelocity: true });
      await C('gamemode survival kb0');
    }

    async function equipBotArmor(tier) {
      const pieces = BOT_ARMOR[tier];
      for (const slot of ['feet', 'legs', 'chest', 'head']) await C(`item replace entity kb0 armor.${slot} with air`);
      for (const it of pieces) {
        const slot = it.endsWith('boots') ? 'feet' : it.endsWith('leggings') ? 'legs' : it.endsWith('chestplate') ? 'chest' : 'head';
        const r = await C(`item replace entity kb0 armor.${slot} with minecraft:${it}`);
        if (/Unknown|Invalid|Incorrect|expected/i.test(r)) notes.push(`equip kb0 ${it}: ${r.trim().slice(0, 100)}`);
      }
    }
    async function resetBot() {
      await C(`tp kb0 0.5 ${Y} 0.5 -90 0`); // vanilla yaw -90 = facing +x (east), toward the mob at OFFSET
      await C('effect clear kb0');
      await C('effect give kb0 minecraft:instant_health 1 5');
    }
    // ⚠ `/tp` ITSELF FORCES `onGround = true` AND ZEROES VERTICAL VELOCITY (.decomp
    // TeleportCommand.java:316-318: `setVelocity(vel.multiply(1,0,1)); setOnGround(true)`,
    // unconditionally, on every teleport) -- found empirically running this pack at the WRONG Y
    // (see kbscen.mjs's own Y comment): a bot teleported one block ABOVE real ground has that
    // forced onGround immediately overwritten false again by ordinary gravity ticking, so every
    // hit read as free-fall, not knockback. Once Y matches the real ground the forced onGround
    // HOLDS (nothing to fall through), and `resetBot()`'s own `/tp` every rep is the reset this
    // pack needs -- no packet-level ground-reporting loop required after all (kept in growbot.mjs
    // as dead-but-true infrastructure, not wired in, for the day a scenario needs a bot that is
    // NOT freshly teleported every rep).

    // ── (A) mob hits bot ──────────────────────────────────────────────────────────────────────
    if (doA) {
      for (const tier of BOT_ARMOR_TIERS) {
        await equipBotArmor(tier);
        for (const atk of ATTACKERS) {
          const key = `${atk.id}@${tier}`;
          const c = casesA[key] || (casesA[key] = { armor: tier, mob: atk.id, special: atk.special || null, vx: [], vy: [], vz: [], noHit: 0 });
          const repsThis = atk.repsA ? (REPS_HG_OVERRIDE || atk.repsA) : REPS_OVERRIDE;
          for (let rep = 0; rep < repsThis; rep++) {
            await resetBot();
            await C('kill @e[tag=refkba]');
            await sleep(100);
            const nbt = atk.nbt ? ',' + atk.nbt : '';
            // Mob at bot.x+OFFSET, explicit yaw 90 (vanilla: facing -x, i.e. facing the bot to its
            // west) -- MeleeAttackGoal's own LookAtEntityGoal only has to hold this, not find it,
            // since the geometry never moves (D-327's own header: mob yaw drives the push direction).
            const prevSpawnId = bot.lastSpawnedEntityId;
            const sr = await C(`summon minecraft:${atk.mob} ${0.5 + OFFSET} ${Y} 0.5 {Tags:["refkba"],PersistenceRequired:1b,Rotation:[90f,0f]${nbt}}`);
            if (DEBUG) console.error(`[dbg] A ${key} rep${rep} summon: ${sr.trim()}`);
            // ⚠ Part C (infra W, 25 Sept 2026) -- IRON_GOLEM ONLY: `IronGolemEntity.initGoals`
            // (.decomp:82-85) gives it NO player-hostile goal by default -- it only fights back
            // through the SAME `UniversalAngerGoal`/`angerTime` system wolves use (this engine's
            // own `Ai.rollAngerTime`, 07k_goals.js:2550-2552, cites the same decomp sharing), armed
            // by taking damage from an attacker. A single harmless tap from the bot (its own attack
            // packet, growbot.mjs's `attack()`) is the real, decomp-grounded way to make the REAL
            // SERVER'S golem angry at the bot and swing back -- golem's own knockbackResistance is
            // 1.0 (entities.json / vanilla attribute) so the tap itself never displaces it.
            if (atk.id === 'iron_golem') {
              let golemId = null;
              for (let t = 0; t < 30 && golemId === null; t++) {
                await sleep(50);
                if (bot.lastSpawnedEntityId !== null && bot.lastSpawnedEntityId !== prevSpawnId) golemId = bot.lastSpawnedEntityId;
              }
              if (golemId !== null) bot.attack(golemId);
              else if (DEBUG) console.error(`[dbg] A ${key} rep${rep}: golem never got its own spawn packet -- no provoke tap sent`);
            }
            const since = Date.now();
            let got = null;
            for (let t = 0; t < 60 && !got; t++) { // bounded poll on OUR OWN server, not an external queue (D-436)
              await sleep(100);
              // FIRST matching packet after `since`, not the last -- a later one can be a further
              // tick's own decayed resync, not the knockback-triggered send itself (found empirically).
              got = bot.velocities.find((v) => v.id === bot.entityId && v.t >= since);
            }
            await C('kill @e[tag=refkba]');
            if (!got) { c.noHit++; continue; }
            c.vx.push(got.vx); c.vy.push(got.vy); c.vz.push(got.vz);
          }
          const n = c.vx.length;
          console.log(`  A ${key.padEnd(24)} vx ${(c.vx.reduce((a, b) => a + b, 0) / (n || 1)).toFixed(4)}  vy ${(c.vy.reduce((a, b) => a + b, 0) / (n || 1)).toFixed(4)}  vz ${(c.vz.reduce((a, b) => a + b, 0) / (n || 1)).toFixed(4)}${c.noHit ? `  NO-CAPTURE x${c.noHit}` : ''}`);
          if (c.noHit === repsThis) notes.push(`A ${key}: never captured a velocity packet in ${repsThis} reps`);
        }
      }
    }

    // ── (B) bot hits mob ──────────────────────────────────────────────────────────────────────
    if (doB) {
      for (const w of WEAPONS) {
        const item = w.item ? `minecraft:${w.item}${w.kb ? `{Enchantments:[{id:"minecraft:knockback",lvl:${w.kb}s}]}` : ''}` : 'air';
        await C(`item replace entity kb0 weapon.mainhand with ${item}`);
        for (const tgt of TARGETS) {
          const key = `${w.id}->${tgt.id}`;
          const c = casesB[key] || (casesB[key] = { weapon: w.id, kb: w.kb, sprint: !!w.sprint, target: tgt.id, kbRes: tgt.kbRes, logTicks: LOG_TICKS, series: [], noHit: 0 });
          // ⚠ ONE spawn per KEY, reused across every rep -- NOT a fresh summon each rep (an earlier
          // version of this runner did that): past roughly 70-80 cumulative summons in one session
          // the server's entity tracker stops sending this bot's connection a Spawn Living Entity
          // packet for brand-new mobs at all (found empirically: `bot.lastSpawnedEntityId` gets
          // stuck on the last id it ever saw, every later case's own summon producing NO new id,
          // forever, for the rest of the run -- some throttle/queue on the tracker side, not this
          // pack's own bug, and not investigated further this pass, `still_owed`). Twelve keys need
          // twelve summons total this way, comfortably under that ceiling; each rep instead
          // teleports the SAME mob back to its spawn point and zeroes its own Motion + refills its
          // health (`/tp` only forces `onGround`/zeroes the VERTICAL component, per this file's own
          // and kbscen.mjs's `/tp` comment -- the horizontal carry-over from the previous rep's hit
          // needs its own explicit `Motion` reset).
          // ⚠ the fake player's own Spawn Living Entity capture is not 100% reliable on a real
          // server under load (found empirically -- occasionally no packet ever arrives for a
          // fresh summon, `still_owed` a real fix) -- retried a few times, re-summoning, before
          // this key gives up (kill+summon is cheap; a silently wrong/stale id is not).
          await reconnectBot();
          let targetId = null;
          for (let attempt = 1; attempt <= 4 && targetId === null; attempt++) {
            if (attempt > 1) await reconnectBot();
            await C('kill @e[tag=refkbb]');
            await sleep(100);
            const prevId = bot.lastSpawnedEntityId;
            const sr = await C(`summon minecraft:${tgt.mob} ${0.5 + OFFSET} ${Y} 0.5 {Tags:["refkbb"],PersistenceRequired:1b}`);
            if (DEBUG) console.error(`[dbg] B ${key} attempt${attempt} summon: ${sr.trim()}`);
            if (tgt.kbRes > 0 && tgt.id !== 'ravager') await C(`attribute @e[tag=refkbb,limit=1] minecraft:generic.knockback_resistance base set ${tgt.kbRes}`);
            for (let t = 0; t < 30 && targetId === null; t++) {
              await sleep(50);
              if (bot.lastSpawnedEntityId !== null && bot.lastSpawnedEntityId !== prevId) targetId = bot.lastSpawnedEntityId;
            }
            if (DEBUG) console.error(`[dbg] B ${key} attempt${attempt} prevId=${prevId} targetId=${targetId}`);
          }
          if (targetId === null) { c.noHit = REPS_OVERRIDE; notes.push(`B ${key}: mob never got its own spawn packet (4 attempts)`); continue; }
          for (let rep = 0; rep < REPS_OVERRIDE; rep++) {
            await C(`tp kb0 0.5 ${Y} 0.5 -90 0`);
            await C(`data merge entity @e[tag=refkbb,limit=1] {Motion:[0.0d,0.0d,0.0d],Health:200.0f}`);
            await C(`tp @e[tag=refkbb,limit=1] ${0.5 + OFFSET} ${Y} 0.5 90 0`);
            // ⚠ THE TARGET MUST KEEP ITS OWN AI (no `NoAI:1b`, unlike an earlier version of this
            // runner) -- a `NoAI` mob's `onGround` never registers true at all (its own physics-tick
            // movement, which is what sets it, is gated the same way its goal AI is), so the
            // knockback vertical clamp's on-ground branch silently never fires and every B-case read
            // exactly `0.0d` vertical Motion (found empirically). This settle wait lets it actually
            // land before the swing, at the cost of a little AI-driven drift the tick-exact log below
            // both records AND the hit-tick detection (kbrefcheck.mjs's `findHitTick`) has to see past.
            await sleep(150);
            // arm the tick-exact logger (own storage list cleared, tick counter zeroed) THEN send the
            // attack packet immediately after -- both travel independently (RCON vs. the game
            // connection), so LOG_TICKS spans a settle margin before the hit AND a decay tail after
            // it; which entry is "the hit tick" is recovered from the logged sequence, not assumed.
            if (w.sprint) { bot.setSprinting(true); await sleep(100); }   // s145: START_SPRINTING every rep (a sprint blow ends it)
            await C('function mclitekb:arm');
            bot.attack(targetId);
            let tNow = 0;
            for (let t = 0; t < 60 && tNow < LOG_TICKS; t++) { // bounded poll on our own server (D-436)
              await sleep(50);
              tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
            }
            await C('scoreboard players set #run mc 0');
            const r = await C('data get storage mclite:kb log');
            const series = parseVecList(r);
            if (DEBUG) console.error(`[dbg] B ${key} rep${rep} series(${series.length}): ${JSON.stringify(series)}`);
            if (series.length < LOG_TICKS) notes.push(`B ${key} rep${rep}: ${series.length}/${LOG_TICKS} logged ticks`);
            if (!series.length) { c.noHit++; continue; }
            c.series.push(series);
          }
          const n = c.series.length;
          const peak = n ? c.series.map((s) => s.reduce((m, [x, , z]) => Math.max(m, Math.hypot(x, z)), 0)).reduce((a, b) => a + b, 0) / n : 0;
          console.log(`  B ${key.padEnd(28)} peak|h| ${peak.toFixed(4)} over ${n} rep(s)${c.noHit ? `  NO-HIT x${c.noHit}` : ''}`);
          if (c.noHit === REPS_OVERRIDE) notes.push(`B ${key}: never logged a Motion series in ${REPS_OVERRIDE} reps`);
        }
      }
    }
  } finally {
    if (bot) bot.close();
    if (rcon) rcon.close();
    await server.stop();
  }

  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const golden = {
    pack: 'knockback', version: '1.18.2', REPS: REPS_OVERRIDE, offset: OFFSET,
    clock: 'A: Set Entity Velocity (0x4f) captured right after a fresh mob spawns adjacent and attacks; ' +
      `B: Interact Entity (0x0d, Attack) sent to the mob, a datapack tick function logs its Motion every tick for ${LOG_TICKS} ticks (tick-exact, runchase.mjs pattern) -- casesB[].series[rep] is that per-tick log, hit tick found from the data (kbrefcheck.mjs findHitTick)`,
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    casesA, casesB, notes,
  };
  // --only=a / --only=b regenerate ONE half: keep the other half from the golden already on disk (infra s138: a part-C
  // `--only=a` run once wrote casesB as {} and silently dropped every B case).
  if (onlyArg) {
    const prev = join(dir, 'knockback.json');
    if (existsSync(prev)) {
      const old = JSON.parse(readFileSync(prev, 'utf8'));
      if (onlyArg === 'a' && old.casesB) golden.casesB = old.casesB;
      if (onlyArg === 'b' && old.casesA) golden.casesA = old.casesA;
      golden.notes = (golden.notes || []).concat([`kept ${onlyArg === 'a' ? 'B' : 'A'} from the previous golden (${old.generatedAt})`]);
    }
  }
  writeFileSync(join(dir, 'knockback.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runkb: ${Object.keys(casesA).length} A-cases, ${Object.keys(casesB).length} B-cases in ${golden.seconds}s -> ${join(dir, 'knockback.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
