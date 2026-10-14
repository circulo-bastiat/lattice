#!/usr/bin/env node
// runfloor.mjs — the referee's NATURAL-SPAWN FLOOR runner (infra I6, s150). Boxes: floorscen.mjs.
// Natural spawning ON, night (18000, frozen), normal; the flat world's grass layer over the whole 9x9-chunk area
// turned to glass; one CREATIVE growbot standing on it at the centre chunk. A datapack TICK function counts every non-player entity inside each box (monsters that spawned there this
// tick) into #n<k>, then sends EVERY non-player entity in the world to the void, so the per-player mob cap never
// fills and surface spawns never pile up. Totals read at the end.
//
//   node tools/referee/runfloor.mjs        (~6 min)      --merge adds another run's counts
//
// Own port 25873 / rcon 26873, work dir $MCLITE_FLOOR_WORKDIR or ~/.mclite-referee-floor; golden -> golden/floor.json.
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { BOXES, FLOOR_Y, T, PLAYER, W } from './floorscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MERGE = process.argv.includes('--merge');

async function main() {
  const workDir = process.env.MCLITE_FLOOR_WORKDIR || join(homedir(), '.mclite-referee-floor');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });   // a fresh world each run: no mobs saved in
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitefloor');
  mkdirSync(join(dp, 'data', 'flr', 'functions'), { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee floor' } }));
  const on = 'execute if score #on flr matches 1 run ';
  const tick = [];
  for (const b of BOXES) {
    // only mobs not seen before are counted (tagged on sight): a mob the void-tp cannot move (a first run counted
    // one stuck mob ~6000 times) must count once
    tick.push(`${on}execute store result score #c${b.k} flr if entity @e[type=!minecraft:player,x=${b.x0 - 1},y=${FLOOR_Y},z=${b.z0 - 1},dx=${W + 1},dy=3,dz=${W + 1},tag=!flrseen]`);
    tick.push(`${on}tag @e[type=!minecraft:player,x=${b.x0 - 1},y=${FLOOR_Y},z=${b.z0 - 1},dx=${W + 1},dy=3,dz=${W + 1},tag=!flrseen] add flrseen`);
    tick.push(`${on}scoreboard players operation #n${b.k} flr += #c${b.k} flr`);
  }
  tick.push(`${on}tp @e[type=!minecraft:player,tag=flrseen] 0 -300 0`);   // (a y=/dy= guard here made a 1-wide box at 0,0 and moved nothing)
  writeFileSync(join(dp, 'data', 'flr', 'functions', 'tick.mcfunction'), tick.join('\n') + '\n');
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['flr:tick'] }));

  const server = await startServer({ workDir, port: 25873, rconPort: 26873, xmx: '1536M' });
  const t0 = Date.now();
  const notes = [];
  let rcon, bot, loop, counts;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword, timeoutMs: 120000 }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c, 120000);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doMobLoot false', 'scoreboard objectives add flr dummy',
      'scoreboard players set #on flr 0', 'datapack enable "file/mclitefloor"']) await C(c);
    // the whole spawning area's ground -> glass (never allowsSpawning), so the per-player cap is not eaten by surface
    // spawns (a first run with the flat grass left in place got 0-6 spawns per box in 6000 ticks)
    notes.push('ground: ' + (await C(`fill -64 ${FLOOR_Y} -64 79 ${FLOOR_Y} 79 minecraft:glass`)).trim());
    for (const b of BOXES) {
      await C(`fill ${b.x0 - 1} ${FLOOR_Y} ${b.z0 - 1} ${b.x0 + W} ${FLOOR_Y + 4} ${b.z0 + W} minecraft:stone`);
      await C(`fill ${b.x0} ${FLOOR_Y + 1} ${b.z0} ${b.x0 + W - 1} ${FLOOR_Y + 3} ${b.z0 + W - 1} minecraft:air`);
      const r = await C(`fill ${b.x0} ${FLOOR_Y} ${b.z0} ${b.x0 + W - 1} ${FLOOR_Y} ${b.z0 + W - 1} minecraft:${b.floor}`);
      if (!/filled/i.test(r)) notes.push(`floor ${b.floor}: ${r.trim()}`);
      await C(`scoreboard players set #n${b.k} flr 0`);
    }
    await sleep(1000);
    bot = await connectFakePlayer({ port: server.port, name: 'flr0', confirmTeleports: true });
    await sleep(1000);
    await C('gamemode creative flr0');
    await C(`tp flr0 ${PLAYER.x} ${PLAYER.y} ${PLAYER.z} 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(PLAYER.x, PLAYER.y, PLAYER.z, true); }, 50);
    await sleep(1500);
    await C('tp @e[type=!minecraft:player] 0 -300 0');
    await C('scoreboard players set #on flr 1');
    await C('gamerule doMobSpawning true');
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const g0 = await gametime();
    const TT = parseInt(process.env.MCLITE_FLOOR_T || T, 10);
    for (;;) {
      const gt = await gametime(); if (gt >= g0 + TT) break;
      if (process.env.MCLITE_FLOOR_DIAG) console.log(`  +${gt - g0}: ${(await C('execute if entity @e[type=!minecraft:player]')).trim()} | seen ${(await C('execute if entity @e[tag=flrseen]')).trim()} | ${(await C('forceload query')).trim().slice(0, 40)}`);
      await sleep(Math.min(process.env.MCLITE_FLOOR_DIAG ? 5000 : 20000, (g0 + TT - gt) * 50));
    }
    await C('gamerule doMobSpawning false');
    await C('scoreboard players set #on flr 0');
    counts = [];
    for (const b of BOXES) {
      const m = /has (-?\d+)/.exec(await C(`scoreboard players get #n${b.k} flr`)); counts.push(m ? parseInt(m[1], 10) : NaN);
      const sel = `@e[type=!minecraft:player,x=${b.x0 - 1},y=${FLOOR_Y},z=${b.z0 - 1},dx=${W + 1},dy=3,dz=${W + 1},limit=1]`;
      const left = await C(`data get entity ${sel} id`);
      if (/has the following/.test(left)) notes.push(`box ${b.k} (${b.floor}) still holds ${left.replace(/.*following entity data: /, '').trim()} at the end: ${(await C(`data get entity ${sel} Pos`)).replace(/.*data: /, '').trim()} vehicle/passengers ${(await C(`data get entity ${sel} Passengers[0].id`)).replace(/.*data: /, '').trim().slice(0, 60)}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  const file = join(dir, 'floor.json');
  mkdirSync(dir, { recursive: true });
  let golden = { pack: 'floor', version: '1.18.2', T, runs: 0,
    clock: 'natural spawning on, night frozen, normal; creative growbot at the centre chunk; a datapack tick function counts non-player entities in each sealed dark box (tagging them) then voids every tagged one; counts summed over the run',
    generatedAt: new Date().toISOString(), seconds: 0, floors: {}, notes: [] };
  if (MERGE && existsSync(file)) golden = JSON.parse(readFileSync(file, 'utf8'));
  BOXES.forEach((b, i) => { (golden.floors[b.floor] || (golden.floors[b.floor] = [])).push(counts[i]); });
  golden.runs++; golden.seconds += Math.round((Date.now() - t0) / 1000); golden.notes.push(...notes);
  writeFileSync(file, JSON.stringify(golden) + '\n');
  for (const [f, c] of Object.entries(golden.floors)) console.log(`  ${f.padEnd(34)} ${c.join(' ')}`);
  console.log(`referee/runfloor: ${Math.round((Date.now() - t0) / 1000)} s -> ${file}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
