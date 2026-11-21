#!/usr/bin/env node
// runpanic.mjs — infra I6 (25 Sept 2026): golden for panicrefcheck.mjs — BURNING-MOB PANIC on the real 1.18.2 server.
// Scenarios: panicscen.mjs. One stone pen per mob, no player, forceloaded; the mob summoned at the pen's centre with
// {Fire:FIRE s} (AI on, persistent, NBT form, Fire:FIRE).
// A datapack TICK function appends the mob's Pos to storage every tick (tick-exact: the function runs before the
// worlds tick, so entry i = the position after i world ticks, entry 0 = the summon position). Own port 25681.
//   node tools/referee/runpanic.mjs        (~REPS x 8 s of game time + ~30 s of setup)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN as LIVE, T, PITCH, REPS, R, FIRE } from './panicscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: the lane's stone floor replaces it

async function main() {
  const workDir = process.env.MCLITE_PANIC_WORKDIR || join(homedir(), '.mclite-referee-panic');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitepanic');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitepanic', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee panic' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitepanic:tick'] }));
  const Z = (k) => k * PITCH;
  const arena = [], spawn = [], log = [];
  LIVE.forEach((s, k) => {
    const z = Z(k);
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 3} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    spawn.push(`data modify storage mclite:panic l${k} set value []`,
      `summon minecraft:${s.mob} 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Fire:${FIRE}s,Tags:["ch${k}","chase"]${s.nbt ? ',' + s.nbt : ''}}`);
    log.push(`data modify storage mclite:panic l${k} append from entity @e[tag=ch${k},limit=1] Pos`);
  });
  spawn.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1');
  const tick = ['execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitepanic:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25681, rconPort: 26681, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of LIVE) cases[s.id] = { mob: s.mob, nbt: s.nbt || '', logs: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule doFireTick false',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0',
      `forceload add -16 -16 16 ${Z(LIVE.length) + 16}`]) await C(c);
    const a = await C('function mclitepanic:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    await sleep(1000);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      await sleep(300);
      await C('function mclitepanic:spawn');
      await sleep(T * 50 + 1000);
      let tNow = 0;
      for (let i = 0; i < 40; i++) {                     // bounded: our own server catching up (D-436 allows this)
        tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow}/${T} ticks ran`);
      for (let k = 0; k < LIVE.length; k++) {
        const L = parsePosList(await C(`data get storage mclite:panic l${k}`));
        const z0 = Z(k);
        cases[LIVE[k].id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (L.length !== T) notes.push(`rep ${rep} ${LIVE[k].id}: ${L.length}/${T} samples (mob gone?)`);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'panic', FIRE, version: '1.18.2', T, REPS, clock: 'summon (AI on, persistent, NBT form, Fire:FIRE) -> tick function logs Pos before each world tick; entry i = after i world ticks; positions local (x along the lane, y above the floor, z across)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'panic.json'), JSON.stringify(golden) + '\n');
  for (const s of LIVE) { const L = cases[s.id].logs[0] || []; console.log(`  ${s.id.padEnd(16)} @40 ${(L[40] || []).slice(0,3).join(',')}  @159 ${(L[159] || []).slice(0,3).join(',')}`); }
  console.log(`referee/runpanic: ${golden.seconds} s -> ${join(dir, 'panic.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
