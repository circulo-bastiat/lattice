#!/usr/bin/env node
// runequipdrop.mjs [--kills N] [--only a,b] — the referee's SPAWN-TIME EQUIPMENT DROP runner (#7865). Scenario: equipdropscen.mjs.
// One growbot survival player (netherite sword, Strength 101); per mob, batches of BATCH NBT-less summons (the server's own
// `initialize` rolls the gear), each then merged NoAI/Health 1 and killed by one Attack packet; every dropped item id is read
// through storage and the EQUIPMENT ones tallied. Golden is MERGED per mob into <referee dir>/golden/equip-drop.json, so
// `--only zombie` can be run alone and the rest later. Own port 25742 + work dir (MCLITE_EQUIPDROP_WORKDIR).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { MOBS, KILLS as K0, BATCH, isGear } from './equipdropscen.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const KILLS = +(argAfter('--kills') || K0);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
async function main() {
  const mobs = MOBS.filter((m) => !ONLY.length || ONLY.includes(m));
  const workDir = process.env.MCLITE_EQUIPDROP_WORKDIR || join(homedir(), '.mclite-referee-equipdrop');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25742, rconPort: 26742, xmx: '1024M' });
  const t0 = Date.now(), notes = [], result = {};
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule maxEntityCramming 0', 'gamerule doMobLoot true', 'forceload add -16 -16 16 16',
      `fill -5 ${FLOOR - 1} -4 5 ${FLOOR + 4} 8 minecraft:air`, `fill -5 ${FLOOR - 1} -4 5 ${FLOOR - 1} 8 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'eq0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival eq0');
    await C(`tp eq0 0.5 ${FLOOR} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await C('effect give eq0 minecraft:strength 100000 100 true');
    await C('item replace entity eq0 weapon.mainhand with minecraft:netherite_sword');
    await sleep(3000);
    for (const mob of mobs) {
      const rec = result[mob] = { kills: 0, errs: 0, items: {} };
      for (let b = 0; b < KILLS / BATCH; b++) {
        await C('kill @e[type=!player]');
        const n0 = bot.spawnedIds.length;
        for (let k = 0; k < BATCH; k++) await C(`summon minecraft:${mob} ${0.5 + (k % 5) - 2} ${FLOOR} ${3.5 + ((k / 5) | 0) % 2}`);
        await C(`execute as @e[type=minecraft:${mob}] run data merge entity @s {NoAI:1b,Health:1f,Silent:1b,PersistenceRequired:1b}`);
        await sleep(600);
        const ids = bot.spawnedIds.slice(n0);
        if (ids.length !== BATCH) notes.push(`${mob} batch ${b}: ${ids.length}/${BATCH} spawn ids`);
        await C('kill @e[type=item]');
        for (const id of ids) bot.attack(id);
        await sleep(1500);
        await C('data modify storage mceq:o l set value []');
        await C('execute as @e[type=item] run data modify storage mceq:o l append from entity @s Item');
        const reply = await C('data get storage mceq:o l');
        for (const comp of reply.slice(Math.max(reply.indexOf('['), 0)).split(/\},\s*\{/)) {
          const m = /id:\s*"minecraft:([a-z0-9_]+)"/.exec(comp);
          if (!m || !isGear(m[1])) continue;
          const c = /Count:\s*(\d+)b/.exec(comp);
          rec.items[m[1]] = (rec.items[m[1]] || 0) + (c ? +c[1] : 1);
        }
        const alive = await rcon.command(`execute if entity @e[type=minecraft:${mob}]`, 1500).catch(() => '');
        const left = /Test passed, count: (\d+)/.exec(alive);
        rec.errs += left ? +left[1] : 0;
        rec.kills += ids.length - (left ? +left[1] : 0);
      }
      console.log(`  ${mob}: ${rec.kills} kills (${rec.errs} survived) ${JSON.stringify(rec.items)}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden'), out = join(dir, 'equip-drop.json');
  mkdirSync(dir, { recursive: true });
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { mobs: {} };
  const golden = { pack: 'equip-drop', version: '1.18.2', clock: 'growbot survival, NBT-less summons (server initialize), NoAI Health 1, one Attack each; equipment item ids tallied',
    generatedAt: new Date().toISOString(), mobs: Object.assign(prev.mobs || {}, result), notes };
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runequipdrop: ${Math.round((Date.now() - t0) / 1000)} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
