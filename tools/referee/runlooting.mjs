#!/usr/bin/env node
// runlooting.mjs [--rolls N] [--only a,b] — the referee's PLAYER-KILL / LOOTING runner (infra I6, s142). Scenarios: lootingscen.mjs.
// One growbot `lt0` in survival; one NoAI, invulnerable, silent target per table in a stone pen; per lane the bot's main hand is
// set by `/item replace`; per table x lane, batches of 25 `execute as lt0 run loot replace block <chest> container.0 27 kill
// @e[tag=<t>]`, each roll's chest Items appended to storage and read once per batch (runloot.mjs's log format/parser).
// Night (a NoAI zombie still burns by day, and a burning mob's table smelts: baked potatoes). Own port 25646 + work dir (MCLITE_LOOTING_WORKDIR, default ~/.mclite-referee-looting); golden -> <referee dir>/golden/looting.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { parseRollLog } from './runloot.mjs';
import { TABLES, LANES, ROLLS as R0 } from './lootingscen.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const ROLLS = +(argAfter('--rolls') || R0);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BATCH = 25, FLOOR = -60, P = `0 ${FLOOR - 3} 0`;
async function main() {
  const tables = TABLES.filter((t) => !ONLY.length || ONLY.includes(t));
  const workDir = process.env.MCLITE_LOOTING_WORKDIR || join(homedir(), '.mclite-referee-looting');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcllt');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcllt', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee looting' } }));
  const spawn = [];
  tables.forEach((t, k) => {
    spawn.push(`summon minecraft:${t} ${4 + (k % 8) * 3} ${FLOOR} ${4 + Math.floor(k / 8) * 3} {NoAI:1b,Invulnerable:1b,Silent:1b,PersistenceRequired:1b,Tags:["lt_${t}"]}`);
    const lines = [];
    for (let i = 0; i < BATCH; i++) {
      lines.push(`execute as lt0 run loot replace block ${P} container.0 27 kill @e[tag=lt_${t},limit=1]`);
      lines.push('data modify storage mcllt:o l append value {R:1b}');
      lines.push(`data modify storage mcllt:o l append from block ${P} Items[]`);
    }
    writeFileSync(join(fdir, `r_${t}.mcfunction`), lines.join('\n') + '\n');
  });
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25646, rconPort: 26646, xmx: '1024M' });
  const t0 = Date.now();
  const result = {}, notes = [];
  let rcon, bot;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'forceload add -16 -16 40 40', `fill -2 ${FLOOR - 4} -2 30 ${FLOOR + 4} 30 minecraft:air`,
      `fill -2 ${FLOOR - 1} -2 30 ${FLOOR - 1} 30 minecraft:stone`, `setblock ${P} minecraft:chest`, 'kill @e[type=!player]']) await C(c);
    const sp = await C('function mcllt:spawn');
    if (/Unknown function/i.test(sp)) throw new Error('datapack not loaded');
    bot = await connectFakePlayer({ port: server.port, name: 'lt0' });
    await sleep(2500);
    await C('gamemode survival lt0'); await C('tp lt0 0.5 ' + FLOOR + ' 0.5');
    for (const [lane, lvl] of Object.entries(LANES)) {
      const r = await C(`item replace entity lt0 weapon.mainhand with minecraft:netherite_sword${lvl ? `{Enchantments:[{id:"minecraft:looting",lvl:${lvl}s}]}` : ''}`);
      if (/No |Invalid|Unknown/i.test(r)) throw new Error('item replace: ' + r);
      result[lane] = {};
      for (const t of tables) {
        const rec = { rolls: 0, empty: 0, items: {} };
        for (let b = 0; b * BATCH < ROLLS; b++) {
          await C('data modify storage mcllt:o l set value []');
          const rr = await C(`function mcllt:r_${t}`);
          if (/Unknown|Invalid|Incorrect|error/i.test(rr)) { notes.push(`${lane} ${t}: ${rr.trim().slice(0, 140)}`); break; }
          const rolls = parseRollLog(await C('data get storage mcllt:o l'));
          if (rolls.length !== BATCH) { notes.push(`${lane} ${t}: batch ${b} read ${rolls.length}/${BATCH} rolls (reply cut) -- dropped`); continue; }
          for (const items of rolls) {
            rec.rolls++;
            if (!items.length) rec.empty++;
            const per = {};
            for (const it of items) per[it.id] = (per[it.id] || 0) + it.count;
            for (const [id, n] of Object.entries(per)) {
              const s = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0, max: 0 });
              s.total += n; s.sq += n * n; s.hits++; s.max = Math.max(s.max, n);
            }
          }
        }
        result[lane][t] = rec;
        process.stdout.write('.');
      }
    }
    process.stdout.write('\n');
  } finally {
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'looting', version: '1.18.2', context: 'execute as <survival player> run loot ... kill <mob>; L0 plain netherite sword, L3 Looting III',
    rolls: ROLLS, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), lanes: result, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'looting.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runlooting: ${golden.seconds} s -> ${join(dir, 'looting.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
