#!/usr/bin/env node
// runram.mjs — infra I6 (s138): golden for ramrefcheck.mjs — the GOAT RAM on the real 1.18.2 server (scenarios: ramscen.mjs).
// ONE stone pen at the origin, ONE growbot (resistance 255, so it lives; `captureVelocity` decodes its own Set Entity
// Velocity packets = the ram's knockback as a real client receives it) at the centre. Per scene x rep: summon the goat
// `dist` blocks EAST (NBT form -> no `initialize` -> no ram cooldown, ramscen.mjs header), start the datapack TICK logger
// the same tick, log the goat's Pos for T ticks. The bot never moves (a fake client ignores its own knockback), so every
// ram in a rep targets the same block. Harness copied from runhurt.mjs (own port 25693, own work dir).
//   node tools/referee/runram.mjs        (~REPS x scenes x 11 s)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, T, REPS, R } from './ramscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
// the NBT form also skips the LONG-JUMP cooldown roll (same resetLongJumpCooldown), so an uncapped goat leaps the pen wall
// (LongJumpTask, up to 5 up) -- give it the memory by hand: long_jump_cooling_down (MemoryModuleType.java:68) held far past T.
const NOJUMP = 'Brain:{memories:{"minecraft:long_jump_cooling_down":{value:1000000}}}';

async function main() {
  const workDir = process.env.MCLITE_RAM_WORKDIR || join(homedir(), '.mclite-referee-ram');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteram');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteram', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee ram' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteram:tick'] }));
  writeFileSync(join(fdir, 'arena.mcfunction'), [
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR + 3} ${R + 1} minecraft:air`,
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR - 1} ${R + 1} minecraft:stone`,
    `fill ${-R - 1} ${FLOOR} ${-R - 1} ${R + 1} ${FLOOR + 2} ${R + 1} minecraft:stone`,
    `fill ${-R} ${FLOOR} ${-R} ${R} ${FLOOR + 2} ${R} minecraft:air`].join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), 'data modify storage mclite:ram p append from entity @e[tag=rg,limit=1] Pos\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), ['execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mcliteram:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25693, rconPort: 26693, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, dist: s.dist, logs: [], knocks: [] };
  let rcon, bot;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0', `forceload add ${-R - 16} ${-R - 16} ${R + 16} ${R + 16}`]) await C(c);
    const a = await C('function mcliteram:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    bot = await connectFakePlayer({ port: server.port, name: 'ram0', captureVelocity: true });
    await C('effect give ram0 minecraft:resistance 1000000 255 true');
    await sleep(800);
    for (const s of SCEN) {
      await C(`gamemode ${s.creative ? 'creative' : 'survival'} ram0`);
      for (let rep = 0; rep < REPS; rep++) {
        await C('scoreboard players set #run mc 0');
        await C('kill @e[type=!player]');
        await C(`tp ram0 0.5 ${FLOOR} 0.5 -90 0`);
        await C('data modify storage mclite:ram p set value []');
        await sleep(300);
        const nbt = ['PersistenceRequired:1b', 'Tags:["rg"]', 'Rotation:[90f,0f]', NOJUMP].concat(s.nbt ? [s.nbt] : []).join(',');
        await C('scoreboard players set #t mc 0');
        await C(`summon minecraft:${s.mob} ${0.5 + s.dist} ${FLOOR} 0.5 {${nbt}}`);
        await C('scoreboard players set #run mc 1');
        const since = Date.now();
        await sleep(T * 50 + 600);
        let tNow = 0;
        for (let i = 0; i < 40; i++) {                       // bounded: our own server catching up (D-436 allows this)
          tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
          if (tNow >= T) break; await sleep(500);
        }
        await C('scoreboard players set #run mc 0');
        const P = parsePosList(await C('data get storage mclite:ram p'));
        const L = P.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round(z * 1e4) / 1e4]);
        if (L.length < T) notes.push(`${s.id} rep ${rep}: ${L.length}/${T} samples`);
        const K = bot.velocities.filter((v) => v.id === bot.entityId && v.t >= since).map((v) => [+v.vx.toFixed(5), +v.vy.toFixed(5), +v.vz.toFixed(5)]);
        cases[s.id].logs.push(L); cases[s.id].knocks.push(K);
      }
      const L = cases[s.id].logs[0] || [];
      console.log(`  ${s.id.padEnd(13)} reps ${cases[s.id].logs.length}  knocks ${cases[s.id].knocks.map((k) => k.length).join('/')}  @199 ${(L[199] || []).join(',')}`);
    }
  } finally {
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'ram', version: '1.18.2', T, REPS, R,
    clock: 'logger armed the same RCON burst as the NBT-form /summon (goat dist blocks east of the bot at 0.5,0,0.5); entry 0 = the first logged tick; knocks = every Set Entity Velocity packet for the bot itself during the rep, blocks/tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ram.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runram: ${golden.seconds} s -> ${join(dir, 'ram.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
