#!/usr/bin/env node
// rundespawn.mjs — the referee's DESPAWN runner (infra I6, s149). Lanes: despawnscen.mjs.
// One growbot survival player stands still at PLAYER; every lane is carved in the air as a sealed
// stone tunnel (forceloaded, so the 140-block lane ticks); ROUNDS x N /summon'ed (un-persistent)
// mobs per lane; survivors counted by tag at each CHECKPOINT tick (gametime from the round's start).
// Night (time 18000), doMobSpawning off, difficulty normal. `--only <regex>` limits lanes.
//
//   node tools/referee/rundespawn.mjs        (~6 min: 3 rounds x 1600 ticks)
//
// Own port 25854 / rcon 26854, work dir $MCLITE_DESPAWN_WORKDIR or ~/.mclite-referee-despawn;
// golden -> golden/despawn.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { LANES, PLAYER, N, ROUNDS, CHECKPOINTS, zOf } from './despawnscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new RegExp(process.argv[onlyArg + 1]) : null;

async function main() {
  const lanes = LANES.filter((l) => !ONLY || ONLY.test(l.id));
  const workDir = process.env.MCLITE_DESPAWN_WORKDIR || join(homedir(), '.mclite-referee-despawn');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  // every summon of a round in ONE tick: a datapack function (an RCON loop of 300 summons spans ~100 ticks,
  // which would start the lanes' idle counters at different times)
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitedsp');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'dsp', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee despawn' } }));
  const lines = [];
  lanes.forEach((l, k) => { for (let i = 0; i < N; i++) lines.push(`summon minecraft:${l.mob} ${l.D + 0.5} ${l.y0} ${zOf(i).toFixed(2)} {Tags:["dl${k}"]}`); });
  writeFileSync(join(dp, 'data', 'dsp', 'functions', 'summon.mcfunction'), lines.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25854, rconPort: 26854, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'gamerule maxEntityCramming 100',
      'forceload add -16 -16 160 16', 'datapack enable "file/mclitedsp"']) await C(c);
    // the tunnels: a stone box per lane, hollowed to 1x3 along z -4..4, light blocks at eye height when asked
    for (const l of lanes) {
      await C(`fill ${l.D - 1} ${l.y0 - 1} -5 ${l.D + 1} ${l.y0 + 3} 5 minecraft:stone`);
      await C(`fill ${l.D} ${l.y0} -4 ${l.D} ${l.y0 + 2} 4 minecraft:air`);
      if (l.light) await C(`fill ${l.D} ${l.y0 + 1} -4 ${l.D} ${l.y0 + 1} 4 minecraft:light[level=${l.light}]`);
    }
    await C(`fill -2 ${PLAYER.y - 1} -2 2 ${PLAYER.y - 1} 2 minecraft:stone`);
    await sleep(800);
    bot = await connectFakePlayer({ port: server.port, name: 'dsp0', confirmTeleports: true });
    await sleep(1000);
    await C('gamemode survival dsp0');
    await C(`effect give dsp0 minecraft:resistance 100000 4 true`);
    await C(`tp dsp0 ${PLAYER.x} ${PLAYER.y} ${PLAYER.z} 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(PLAYER.x, PLAYER.y, PLAYER.z, true); }, 50);
    await sleep(1500);
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const count = async (tag) => { const r = await C(`execute if entity @e[tag=${tag}]`); const m = /count:\s*(\d+)/.exec(r); return m ? parseInt(m[1], 10) : 0; };
    for (const l of lanes) cases[l.id] = { mob: l.mob, D: l.D, light: l.light, y0: l.y0, n: 0, alive: CHECKPOINTS.map(() => 0) };
    for (let r = 0; r < ROUNDS; r++) {
      await C('kill @e[type=!minecraft:player]');
      await sleep(300);
      const g0 = await gametime();
      const out = await C('function dsp:summon');
      if (r === 0) notes.push('summon function: ' + out.trim());
      for (const [ci, cp] of CHECKPOINTS.entries()) {
        let gt = await gametime();
        if (gt < g0 + cp) await sleep((g0 + cp - gt) * 50);
        for (let q = 0; q < 50 && (gt = await gametime()) < g0 + cp; q++) await sleep(50);
        if (gt > g0 + cp + 20) notes.push(`round ${r} checkpoint ${cp} read late at +${gt - g0}`);
        for (const [k, l] of lanes.entries()) cases[l.id].alive[ci] += await count(`dl${k}`);
      }
      for (const l of lanes) cases[l.id].n += N;
      console.log(`  round ${r + 1}/${ROUNDS} done`);
    }
    for (const l of lanes) console.log(`  ${l.id.padEnd(18)} n ${cases[l.id].n} alive ${cases[l.id].alive.join(' ')}`);
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'despawn', version: '1.18.2', checkpoints: CHECKPOINTS,
    clock: 'growbot survival player standing still (Resistance V); sealed dark 1x3 stone tunnels along z at x=D, forceloaded; /summon (un-persistent) N per lane per round; survivors = execute if entity @e[tag] at gametime checkpoints from the round start; night, doMobSpawning off, normal',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'despawn.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/rundespawn: ${golden.seconds} s -> ${join(dir, 'despawn.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
