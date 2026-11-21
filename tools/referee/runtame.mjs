#!/usr/bin/env node
// runtame.mjs — the referee's TAMING runner (infra I6, s143). Scenarios: tamescen.mjs.
//   node tools/referee/runtame.mjs      (7 scenes x 15 batches x 20 mobs, ~4 min)
// ONE growbot survival player (confirmTeleports + captureVelocity: it sees each mob's Spawn Living Entity id). Per batch: every
// non-player entity killed, 64 of the item put in the main hand, BATCH wild mobs summoned WITH NBT (NoAI, silent) on a 5 x 4
// grid 2..5 blocks +z of the bot (all inside the 6-block interact range), 1 s, one Interact packet per mob, 1.5 s, then:
// owned mobs (`Owner` present -> tag), mobs still alive, items left in the hand. Own port 25677 + work dir
// (MCLITE_TAME_WORKDIR, default ~/.mclite-referee-tame); golden -> <referee dir>/golden/tame.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, BATCH, BATCHES } from './tamescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const count = (r) => { const m = /count:\s*(\d+)/.exec(r); return m ? +m[1] : 0; };
async function main() {
  const workDir = process.env.MCLITE_TAME_WORKDIR || join(homedir(), '.mclite-referee-tame');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25677, rconPort: 26677, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { attempts: 0, tamed: 0, alive: 0, used: 0 };
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 16 16',
      `fill -6 ${FLOOR - 1} -4 6 ${FLOOR + 4} 8 minecraft:air`, `fill -6 ${FLOOR - 1} -4 6 ${FLOOR - 1} 8 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'tm0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival tm0');
    await C(`tp tm0 0.5 ${FLOOR} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await sleep(3500);
    for (const s of SCEN) {
      for (let b = 0; b < BATCHES; b++) {
        await C('kill @e[type=!player]');
        await C('clear tm0');
        await C(`item replace entity tm0 weapon.mainhand with minecraft:${s.item} 64`);
        const n0 = bot.spawnedIds.length;
        for (let i = 0; i < BATCH; i++) {
          const x = (i % 5) - 2 + 0.5, z = Math.floor(i / 5) + 2 + 0.5;
          await C(`summon minecraft:${s.mob} ${x} ${FLOOR} ${z} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["tb"]}`);
        }
        await sleep(1000);
        const ids = bot.spawnedIds.slice(n0);
        if (ids.length !== BATCH) notes.push(`${s.id} batch ${b}: saw ${ids.length} spawn ids, expected ${BATCH}`);
        for (const id of ids) bot.interact(id);
        await sleep(1500);
        await C('execute as @e[tag=tb] if data entity @s Owner run tag @s add owned');
        const tamed = count(await C('execute if entity @e[tag=tb,tag=owned]'));
        const alive = count(await C('execute if entity @e[tag=tb]'));
        const left = /Found (\d+) matching/.exec(await C(`clear tm0 minecraft:${s.item} 0`));
        const c = cases[s.id];
        c.attempts += ids.length; c.tamed += tamed; c.alive += alive; c.used += 64 - (left ? +left[1] : 0);
      }
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(22)} attempts ${c.attempts} tamed ${c.tamed} alive ${c.alive} used ${c.used}`); }
  const golden = { pack: 'tame', version: '1.18.2', BATCH, BATCHES, clock: 'growbot survival, 64 of the item in hand, BATCH NoAI NBT-summoned wild mobs, one Interact each, 1.5 s -> owned/alive/items used',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tame.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runtame: ${golden.seconds} s -> ${join(dir, 'tame.json')}${notes.length ? '\n  notes: ' + notes.slice(0, 5).join(' | ') : ''}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
