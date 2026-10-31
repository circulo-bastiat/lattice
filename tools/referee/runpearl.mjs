#!/usr/bin/env node
// runpearl.mjs -- #6312 (G17-L61): the SERVER side of the 'pearl' lockstep lane. One run of the real 1.18.2 server: a survival growbot,
// the scripted look/give commands (pearlscen.mjs via playerlane.mjs) run by a datapack tick function, the 'use' as a REAL Use Item packet
// sent a few ticks after each look. The tick function logs, before every world tick, the player Pos/Health and the nearest ender_pearl and
// endermite (Pos, Motion, present flag). Rows are playerlane laneRows; `uses` = the ticks at which a pearl first existed (the packet's
// wall-clock arrival is not tick-exact, so the engine driver throws at those ticks).
//   MCLITE_PEARL_OUT=<file> MCLITE_PEARL_WORKDIR=<dir> MCLITE_JVM_ARGS=<javaagent..> MCLITE_LOCKSTEP_RESET=<file> node tools/referee/runpearl.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, lockReferee, resolveBusyPort } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { pearlScript, arenaCommands, cowCommand, T, AT } from './pearlscen.mjs';
import { serverCommands, logCommands, laneRow } from './lockstep/playerlane.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOT = 'pearl0', SEND_AFTER = 4;   // ticks after the look step before the Use Item packet goes out

// per tick: flags 0/1 + Pos + Motion of the nearest entity of `type` (a placeholder triple when absent, so every list is T long)
function entityLog(type, key) {
  const sel = `@e[type=minecraft:${type},limit=1,sort=nearest]`;
  return [`execute if entity ${sel} run data modify storage mclite:lane ${key}n append value 1`,
    `execute unless entity ${sel} run data modify storage mclite:lane ${key}n append value 0`,
    `execute if entity ${sel} run data modify storage mclite:lane ${key}p append from entity ${sel} Pos`,
    `execute unless entity ${sel} run data modify storage mclite:lane ${key}p append value [0.0d,0.0d,0.0d]`,
    `execute if entity ${sel} run data modify storage mclite:lane ${key}v append from entity ${sel} Motion`,
    `execute unless entity ${sel} run data modify storage mclite:lane ${key}v append value [0.0d,0.0d,0.0d]`];
}
export function datapack(workDir, script) {
  const dp = join(workDir, 'world', 'datapacks', 'mclitepearl'), f = join(dp, 'data', 'mclitepearl', 'functions');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(f, { recursive: true }); mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee pearl' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitepearl:tick'] }));
  const steps = [];
  for (const [t, cmds] of Object.entries(serverCommands(script, BOT))) for (const c of cmds) steps.push(`execute if score #run mc matches 1 if score #t mc matches ${t} run ${c}`);
  const log = [...logCommands(BOT, []), ...entityLog('ender_pearl', 'pearl'), ...entityLog('endermite', 'mite')];
  const spawn = ['data modify storage mclite:lane player set value []', 'data modify storage mclite:lane health set value []',
    ...['pearl', 'mite'].flatMap((k) => [`data modify storage mclite:lane ${k}n set value []`, `data modify storage mclite:lane ${k}p set value []`, `data modify storage mclite:lane ${k}v set value []`]),
    'kill @e[type=!player]', cowCommand(), `tp ${BOT} ${AT.join(' ')} 0 0`, `clear ${BOT}`, 'scoreboard players set #t mc 0', 'scoreboard players set #run mc 1'];
  const tick = ['scoreboard players set #20 mc 20', 'execute store result score #g mc run time query gametime', 'scoreboard players operation #g mc %= #20 mc',
    'execute if score #arm mc matches 1 if score #g mc matches 0 run function mclitepearl:spawn', 'execute if score #arm mc matches 1 if score #g mc matches 0 run scoreboard players set #arm mc 0',
    ...steps, `execute if score #run mc matches 1 if score #t mc matches ..${T - 1} run function mclitepearl:log`, 'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(f, 'arena.mcfunction'), arenaCommands().join('\n') + '\n');
  writeFileSync(join(f, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(f, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(f, 'tick.mcfunction'), tick.join('\n') + '\n');
}
const nums = (s) => (s.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?(?=[dDf])/g) || []).map(parseFloat);
export function rowsFromLog({ player, health, pearl, mite }) {
  const rows = [];
  for (let t = 0; t < player.length; t++) {
    const ents = [];
    for (const [type, L] of [['ender_pearl', pearl], ['endermite', mite]]) if (L.n[t]) ents.push({ type, x: L.p[t][0], y: L.p[t][1], z: L.p[t][2], vx: L.v[t][0], vy: L.v[t][1], vz: L.v[t][2] });
    rows.push(laneRow(t, { player: { x: player[t][0], y: player[t][1], z: player[t][2], health: health[t] }, entities: ents }));
  }
  return rows;
}
async function main() {
  const script = pearlScript();
  const want = await resolveBusyPort({ port: +process.env.MCLITE_PEARL_PORT || 25691, rconPort: +process.env.MCLITE_PEARL_RCON || 26691, workDir: process.env.MCLITE_PEARL_WORKDIR || join(homedir(), '.mclite-referee-pearl') });
  await lockReferee({ workDir: want.workDir });
  datapack(want.workDir, script);
  const server = await startServer({ workDir: want.workDir, port: want.port, rconPort: want.rconPort, xmx: '1024M' });
  let rcon, bot, out;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0',
      'gamerule naturalRegeneration false', 'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0', 'forceload add -16 -16 16 16']) await C(c);
    if (/Unknown function/i.test(await C('function mclitepearl:arena'))) throw new Error('datapack not loaded');
    bot = await connectFakePlayer({ port: server.port, name: BOT, confirmTeleports: true });
    await C(`gamemode survival ${BOT}`); await C(`tp ${BOT} ${AT.join(' ')} 0 0`);
    await sleep(1000);
    const reset = process.env.MCLITE_LOCKSTEP_RESET;
    if (reset) writeFileSync(reset, 'rep0');
    await C('kill @e[type=!player]');
    await sleep(reset ? 4000 : 300);
    if (reset) { writeFileSync(reset, 'rep0arm'); await sleep(200); await C('scoreboard players set #arm mc 1'); await sleep(500); } else await C('function mclitepearl:spawn');
    // the Use Item packets: poll #t, send each a few ticks after its look step
    const lookTicks = script.filter((s) => s.op === 'look').map((s) => s.tick), sent = new Set();
    for (let t = 0; t < T; ) {
      t = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
      lookTicks.forEach((lt, i) => { if (t >= lt + SEND_AFTER && !sent.has(i)) { sent.add(i); bot.useItem(0); } });
      await sleep(40);
    }
    await C('scoreboard players set #run mc 0');
    if (process.env.MCLITE_PEARL_DEBUG) console.log('others:', await C('kill @e[type=!minecraft:player,type=!minecraft:cow]'), '| player', (await C(`data get entity ${BOT}`)).replace(/Inventory:\s*\[.*?\], /s, '').slice(0, 1800));
    const get = async (k) => C(`data get storage mclite:lane ${k}`);
    const L = (k) => nums(k);
    const triples = (s) => parsePosList(s);
    const flags = ((s) => (s.match(/\b[01](?=[,\]])/g) || []).map(Number));
    const ent = async (k) => ({ n: flags(await get(k + 'n')), p: triples(await get(k + 'p')), v: triples(await get(k + 'v')) });
    const player = triples(await get('player')), health = L(await get('health'));
    const pearl = await ent('pearl'), mite = await ent('mite');
    const rows = rowsFromLog({ player, health, pearl, mite });
    const uses = []; pearl.n.forEach((n, t) => { if (n && !pearl.n[t - 1]) uses.push(t); });
    out = { T, rows, uses };
  } finally {
    if (bot) try { bot.close(); } catch (e) { /* gone */ }
    if (rcon) rcon.close();
    await server.stop();
  }
  writeFileSync(process.env.MCLITE_PEARL_OUT || join(want.workDir, 'pearl.json'), JSON.stringify(out));
  console.log(`runpearl: ${out.rows.length} rows, throws at ticks ${out.uses.join(',')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
