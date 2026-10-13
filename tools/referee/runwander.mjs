#!/usr/bin/env node
// runwander.mjs — infra I6 (s147, 25 Sept 2026): golden for wanderrefcheck.mjs — IDLE WANDER on the real 1.18.2 server (the
// runpanic.mjs harness, no fire). Scenarios + the question: wanderscen.mjs. PENS stone pens per mob, no player, forceloaded; each
// mob summoned at its pen's centre (AI on, PersistenceRequired). A datapack TICK function appends every mob's Pos to storage every
// STEP ticks (entry i = after i*STEP world ticks). Own port 25682.
//   node tools/referee/runwander.mjs        (~REPS x 60 s of game time + setup, ~4 min)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, T, STEP, PITCH, REPS, R, PENS, walks } from './wanderscen.mjs';
const LIVE = [];
for (const s of SCEN) for (let p = 0; p < PENS; p++) LIVE.push(Object.assign({ pen: p }, s));
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: the lane's stone floor replaces it

async function main() {
  const workDir = process.env.MCLITE_WANDER_WORKDIR || join(homedir(), '.mclite-referee-wander');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitewander');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitewander', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee wander' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitewander:tick'] }));
  const Z = (k) => k * PITCH;
  const arena = [], spawn = [], log = [];
  LIVE.forEach((s, k) => {
    const z = Z(k);
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 3} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    spawn.push(`data modify storage mclite:wander l${k} set value []`,
      `summon minecraft:${s.mob} 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["ch${k}","chase"]${s.nbt ? ',' + s.nbt : ''}}`);
    log.push(`data modify storage mclite:wander l${k} append from entity @e[tag=ch${k},limit=1] Pos`);
  });
  spawn.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1');
  const tick = ['scoreboard players operation #m mc = #t mc', 'scoreboard players operation #m mc %= #step mc',
    'execute if score #run mc matches 1 if score #m mc matches 0 if score #t mc matches ..' + (T - 1) + ' run function mclitewander:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25682, rconPort: 26682, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, nbt: s.nbt || '', logs: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0', `scoreboard players set #step mc ${STEP}`,
      `forceload add -16 -16 16 ${Z(LIVE.length) + 16}`]) await C(c);
    const a = await C('function mclitewander:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    await sleep(1000);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      await sleep(300);
      await C('function mclitewander:spawn');
      await sleep(T * 50 + 1000);   // no player: the pens tick because they are forceloaded
      let tNow = 0;
      for (let i = 0; i < 40; i++) {                     // bounded: our own server catching up (D-436 allows this)
        tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow}/${T} ticks ran`);
      // 36 walking mobs keep the server busy enough that a big storage reply's later RCON fragments miss rcon.mjs's 40 ms settle
      // window (logs cut at ~160-340 of 600 samples, first run): stop the load before reading.
      await C('kill @e[type=!player]');
      await sleep(500);
      for (let k = 0; k < LIVE.length; k++) {
        const L = parsePosList(await C(`data get storage mclite:wander l${k}`));
        const z0 = Z(k);
        cases[LIVE[k].id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (L.length !== T / STEP) notes.push(`rep ${rep} ${LIVE[k].id}: ${L.length}/${T / STEP} samples (mob gone?)`);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'wander', version: '1.18.2', T, STEP, REPS, PENS, clock: 'summon (AI on, persistent) -> tick function logs Pos every STEP ticks before the world tick; entry i = after i*STEP world ticks; positions local (x along the lane, y above the floor, z across)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wander.json'), JSON.stringify(golden) + '\n');
  for (const s of SCEN) { const W = cases[s.id].logs.map(walks); const m = (a) => (a.reduce((p, q) => p + q, 0) / a.length).toFixed(2); console.log(`  ${s.id.padEnd(12)} walks/run ${m(W.map((q) => q.n))}  first walk @${m(W.map((q) => q.first * STEP))} ticks  (${W.length} runs)`); }
  console.log(`referee/runwander: ${golden.seconds} s -> ${join(dir, 'wander.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
