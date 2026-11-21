#!/usr/bin/env node
// runraid.mjs — the referee's RAIDS runner (infra W, 25 Sept 2026): wave composition per
// difficulty vs the real 1.18.2 dedicated server. Scenarios: raidscen.mjs.
//
// ⚠⚠ FINDING (not an engine bug -- a real-server fact this pack had to discover empirically,
// since it changes how golden data can be collected AT ALL): the `/raid` debug command
// (RaidCommand.java: start/stop/check/setomen/glow/spawnleader) is DEAD CODE on the real 1.18.2
// dedicated server -- `CommandManager.java`'s own registration list (the ONLY place any vanilla
// command gets wired to the dispatcher, read in full) never calls `RaidCommand.register`.
// Confirmed empirically first (`raid`, `raid start`, `raid start 1`, `help raid` all four came
// back "Unknown or incomplete command" from a level-4 rcon console AND from an opped player),
// then confirmed by the absence in .decomp -- no false lead kept in this file. So there is no
// shortcut around the REAL trigger: `StatusEffects.java:94-107` (`bad_omen`'s own
// `applyUpdateEffect`, invoked every tick while the effect is active since bad omen overrides
// `canApplyUpdateEffect` to unconditional `true`) calls `world.isNearOccupiedPointOfInterest(pos)`
// (radius 1 CHUNK SECTION -- .decomp `ServerWorld.java:1211-1212`) and only then
// `RaidManager.startRaid`. NO WORLDGEN is still true -- an occupied POI is a placed bed plus a
// summoned villager that claims it as home, not generated terrain.
//
// Per rep: place a bed, summon a villager onto it (claims it as `Brain.memories."minecraft:home"`,
// polled via `/data get` -- confirmation, not a guess), give the growbot Bad Omen, then for each
// wave: sleep the deterministic 300-tick (15s) `preRaidTicks` countdown (`Raid.java:282-311`,
// `DEFAULT_PRE_RAID_TICKS`/its own reset-to-300 between waves -- no polling loop, D-436: this is
// one bounded sleep on a countdown whose LENGTH is a constant already read out of .decomp, not
// an unknown wait), count each raider type near the bot via a scoreboard tally (`RaiderEntity`'s
// own `Wave` tag, read via `execute as @e[type=...,nbt={Wave:N}] run scoreboard players add`),
// then `kill @e[type=#minecraft:raiders]` to clear the wave and let the cooldown advance.
//
//   node tools/referee/runraid.mjs
//   env: MCLITE_RAID_ONLY=<comma ids>, MCLITE_RAID_REPS_CAP=<n>, MCLITE_RAID_WAVES_CAP=<n>,
//        MCLITE_RAID_HOME_WAIT_MS, MCLITE_RAID_TRIGGER_WAIT_MS -- bound a session-limited run.
//
// Own port 25861 / rcon 26861, work dir env MCLITE_RAID_WORKDIR (falls back to
// ~/.mclite-referee-raid); golden -> golden/raid-waves.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, RAIDER_TYPES } from './raidscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRE_RAID_TICKS = 300; // Raid.java DEFAULT_PRE_RAID_TICKS / its own reset-to-300 between waves
const PRE_RAID_MS = PRE_RAID_TICKS * 50 + 3000; // + margin for rcon/tick-loop slack

async function main() {
  const workDir = process.env.MCLITE_RAID_WORKDIR || join(homedir(), '.mclite-referee-raid');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25861, rconPort: 26861, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 1000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule disableRaids false', 'scoreboard objectives add rc dummy']) await C(c);
    // (a single 3216-long fill exceeds /fill's 32768-block limit and silently builds NOTHING -- the bed then floated,
    // the villager fell 44 blocks and never claimed it. Each rep builds its own floor below, s149.)
    await C(`fill -8 -17 -8 8 -17 8 minecraft:stone`);
    await sleep(1000);
    bot = await connectFakePlayer({ port: server.port, name: 'rd0', confirmTeleports: true, captureVelocity: true });
    await sleep(1000);
    await C('gamemode survival rd0');
    let px = 0, py = -16, pz = 0;
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(px, py, pz, true); }, 50);
    await sleep(1500);

    const countType = async (type, wave) => {
      await C('scoreboard players set n rc 0');
      // positioned at the rep's own spot: from the console `distance` is measured from the world spawn, not the raid (s149)
      await C(`execute positioned ${px} -40 ${pz} as @e[type=minecraft:${type},distance=..160,nbt={Wave:${wave}}] run scoreboard players add n rc 1`);
      const r = await C('scoreboard players get n rc');
      const m = /(-?\d+)/.exec(r);
      return m ? parseInt(m[1], 10) : 0;
    };
    const countAll = async (wave) => {
      const out = {};
      for (const t of RAIDER_TYPES) out[t] = await countType(t, wave);
      return out;
    };
    const villagerHasHome = async () => {
      const r = await C('data get entity @e[type=minecraft:villager,limit=1] Brain.memories."minecraft:home"');
      return /pos:\s*\[I;/.test(r);
    };

    let repOffset = 0;
    const onlyIds = (process.env.MCLITE_RAID_ONLY || '').split(',').filter(Boolean);
    const repsCap = process.env.MCLITE_RAID_REPS_CAP ? parseInt(process.env.MCLITE_RAID_REPS_CAP, 10) : Infinity;
    const wavesCap = process.env.MCLITE_RAID_WAVES_CAP ? parseInt(process.env.MCLITE_RAID_WAVES_CAP, 10) : Infinity;
    const homeWaitMs = process.env.MCLITE_RAID_HOME_WAIT_MS ? parseInt(process.env.MCLITE_RAID_HOME_WAIT_MS, 10) : 6000;
    const triggerWaitMs = process.env.MCLITE_RAID_TRIGGER_WAIT_MS ? parseInt(process.env.MCLITE_RAID_TRIGGER_WAIT_MS, 10) : 20000;
    const scenList = onlyIds.length ? SCEN.filter((s) => onlyIds.includes(s.id)) : SCEN;
    for (const s0 of scenList) {
      const s = Object.assign({}, s0, { reps: Math.min(s0.reps, repsCap) });
      await C(`difficulty ${s.difficulty}`);
      const repsData = [];
      for (let r = 0; r < s.reps; r++) {
        repOffset += 400;
        px = repOffset; pz = 3;
        await C(`forceload add ${px - 96} -96 ${px + 96} 96`);
        await C(`fill ${px - 8} -17 -8 ${px + 8} -17 8 minecraft:stone`);
        await C(`tp rd0 ${px} -16 ${pz} 0 0`);
        await sleep(400);
        await C(`setblock ${px} -16 0 minecraft:red_bed[facing=north,part=head]`);
        await C(`setblock ${px} -16 1 minecraft:red_bed[facing=north,part=foot]`);
        await C(`summon minecraft:villager ${px} -16 2 {VillagerData:{profession:"minecraft:none",type:"minecraft:plains",level:1}}`);
        let claimed = false;
        for (let waited = 0; waited < homeWaitMs; waited += 1500) {
          await sleep(1500);
          if (await villagerHasHome()) { claimed = true; break; }
        }
        if (!claimed) { notes.push(`${s.id} rep${r}: villager never claimed the bed as home within ${homeWaitMs}ms`); await C(`kill @e[type=minecraft:villager]`); continue; }
        await C(`effect give rd0 minecraft:bad_omen 600 ${s.omenLevel - 1} true`);
        let triggered = false;
        for (let waited = 0; waited < triggerWaitMs; waited += 2000) {
          await sleep(2000);
          const c1 = await countAll(1);
          if (Object.values(c1).some((n) => n > 0)) { triggered = true; break; }
        }
        if (!triggered) { notes.push(`${s.id} rep${r}: no raiders observed with Wave:1 within ${triggerWaitMs}ms of Bad Omen -- POI trigger did not fire`); await C(`kill @e[type=minecraft:villager]`); continue; }
        const totalWaves = Math.min(s.waveCount + (s.extraWave ? 1 : 0), wavesCap);
        const waves = [];
        for (let w = 1; w <= totalWaves; w++) {
          if (w > 1) await sleep(PRE_RAID_MS);
          const counts = await countAll(w);
          waves.push({ waveIdx: w, isExtra: w > s.waveCount, counts });
          await C('kill @e[type=#minecraft:raiders]');
          await sleep(500);
        }
        await C('kill @e[type=minecraft:villager]');
        await C(`forceload remove ${px - 96} -96 ${px + 96} 96`);
        repsData.push(waves);
        console.log(`  ${s.id} rep${r}: ${JSON.stringify(waves.map((x) => x.counts))}`);
      }
      cases[s.id] = { difficulty: s.difficulty, omenLevel: s.omenLevel, waveCount: s.waveCount, extraWave: s.extraWave, repsData };
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'raid-waves', version: '1.18.2',
    clock: "growbot survival player; a real bed + summoned villager (Brain minecraft:home memory confirmed) is the occupied POI, a real /effect give bad_omen triggers RaidManager.startRaid via StatusEffects.java:104-105 exactly as a real player would reach it (the /raid debug command is unregistered on the real server -- this file's own header finding); real Raid.tick countdown/wave spawns, raiders counted via their own Wave NBT tag through a scoreboard tally -- never a number this file invented",
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'raid-waves.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runraid: ${golden.seconds} s -> ${join(dir, 'raid-waves.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
