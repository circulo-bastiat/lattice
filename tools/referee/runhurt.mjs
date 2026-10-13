#!/usr/bin/env node
// runhurt.mjs — infra I6 (s137): golden for hurtrefcheck.mjs — HURT PANIC on the real 1.18.2 server. Scenarios: hurtscen.mjs.
// ONE pen at the origin, ONE growbot (survival, resistance 255) at its centre facing +x (vanilla yaw -90). Per mob x rep:
// summon it OFFSET east (AI on, persistent, NBT form -- so no `initialize` roll, SummonCommand.java:89-90), let it land,
// start the datapack TICK logger, and punch it with the bot's real Interact-attack packet. The logger appends Pos and
// HurtTime every tick; the hit tick is the first entry with HurtTime 10, and the log is re-based there. Own port 25691.
//   node tools/referee/runhurt.mjs        (~REPS x mobs x 8 s)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN as LIVE, T, REPS, R, OFFSET } from './hurtscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const LOGN = T + 60;               // raw ticks logged per run (the hit lands a few ticks after the logger starts)
const parseInts = (reply) => { const m = /\[(.*)\]\s*$/.exec(reply.trim()); return m ? m[1].split(',').map((q) => parseInt(q, 10)).filter((v) => !Number.isNaN(v)) : []; };

async function main() {
  const workDir = process.env.MCLITE_HURT_WORKDIR || join(homedir(), '.mclite-referee-hurt');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitehurt');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitehurt', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee hurt' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitehurt:tick'] }));
  writeFileSync(join(fdir, 'arena.mcfunction'), [
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR + 3} ${R + 1} minecraft:air`,
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR - 1} ${R + 1} minecraft:stone`,
    `fill ${-R - 1} ${FLOOR} ${-R - 1} ${R + 1} ${FLOOR + 1} ${R + 1} minecraft:stone`,
    `fill ${-R} ${FLOOR} ${-R} ${R} ${FLOOR + 1} ${R} minecraft:air`].join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), ['data modify storage mclite:hurt p append from entity @e[tag=hp,limit=1] Pos',
    'data modify storage mclite:hurt h append from entity @e[tag=hp,limit=1] HurtTime'].join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), ['execute if score #run mc matches 1 if score #t mc matches ..' + (LOGN - 1) + ' run function mclitehurt:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25691, rconPort: 26691, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of LIVE) cases[s.id] = { mob: s.mob, logs: [], hitAt: [] };
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
    const a = await C('function mclitehurt:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    bot = await connectFakePlayer({ port: server.port, name: 'hurt0', captureVelocity: true });
    await C('gamemode survival hurt0');
    await C('effect give hurt0 minecraft:resistance 1000000 255 true');
    await sleep(800);
    for (const s of LIVE) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('scoreboard players set #run mc 0');
        await C('kill @e[type=!player]');
        await C(`tp hurt0 0.5 ${FLOOR} 0.5 -90 0`);
        await C('data modify storage mclite:hurt p set value []');
        await C('data modify storage mclite:hurt h set value []');
        await sleep(150);
        await C(`summon minecraft:${s.mob} ${0.5 + OFFSET} ${FLOOR} 0.5 {PersistenceRequired:1b,Tags:["hp"],Rotation:[90f,0f]}`);
        let id = null;
        for (let t = 0; t < 30 && id === null; t++) { await sleep(50); id = bot.lastSpawnedEntityId; }
        await sleep(400);                                    // land (a NoAI-free mob needs real ticks for onGround)
        await C('scoreboard players set #t mc 0');
        await C('scoreboard players set #run mc 1');
        await sleep(100);
        if (id !== null) bot.attack(id);
        await sleep(LOGN * 50 + 800);
        let tNow = 0;
        for (let i = 0; i < 40; i++) {                       // bounded: our own server catching up (D-436 allows this)
          tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
          if (tNow >= LOGN) break; await sleep(500);
        }
        await C('scoreboard players set #run mc 0');
        const P = parsePosList(await C('data get storage mclite:hurt p'));
        const H = parseInts(await C('data get storage mclite:hurt h'));
        const h = H.indexOf(10);
        if (id === null || h < 0) { notes.push(`${s.id} rep ${rep}: no hit landed (id ${id}, HurtTime max ${Math.max(0, ...H)})`); continue; }
        const L = P.slice(h, h + T).map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round(z * 1e4) / 1e4]);
        if (L.length < T) notes.push(`${s.id} rep ${rep}: ${L.length}/${T} samples after the hit`);
        cases[s.id].logs.push(L); cases[s.id].hitAt.push(h);
      }
      const L = cases[s.id].logs[0] || [];
      console.log(`  ${s.id.padEnd(10)} reps ${cases[s.id].logs.length}  hit@ ${cases[s.id].hitAt.join('/')}  @60 ${(L[60] || []).join(',')}`);
    }
  } finally {
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'hurt', version: '1.18.2', T, REPS, OFFSET,
    clock: 'summon (AI on, persistent, NBT form) east of a survival bot at the pen centre -> the bot punches it -> tick function logs Pos+HurtTime; entry 0 = the first tick with HurtTime 10; positions relative to the pen centre corner (bot at 0.5,0,0.5)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hurt.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runhurt: ${golden.seconds} s -> ${join(dir, 'hurt.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
