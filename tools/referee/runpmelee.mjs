#!/usr/bin/env node
// runpmelee.mjs — the referee's PLAYER MELEE runner (infra I6, s143). Scenarios: pmeleescen.mjs.
//   node tools/referee/runpmelee.mjs     (~22 scenes x REPS x ~3 s)
// ONE growbot survival player (confirmTeleports + captureVelocity, so it sees each target's Spawn Living Entity id and its
// Player Position packets count); per scene/rep: every non-player entity killed, weapon by /item replace, effect by /effect,
// the target(s) summoned WITH NBT (NoAI, max health 100), > 1.5 s so the attack cooldown is full, then the bot's own Attack
// packet (a crit scene first reports two descending not-on-ground positions: fallDistance > 0), 0.6 s, Health read back.
// Own port 25675 + work dir (MCLITE_PMELEE_WORKDIR, default ~/.mclite-referee-pmelee); golden -> <referee dir>/golden/player-melee.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, REPS, DZ, SWEEP_DX } from './pmeleescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const itemArg = (a) => `minecraft:${a.item}${a.ench ? `{Enchantments:[${a.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}`;
const armorNbt = (mat) => `ArmorItems:[${['boots', 'leggings', 'chestplate', 'helmet'].map((p) => `{id:"minecraft:${mat}_${p}",Count:1b}`).join(',')}],ArmorDropChances:[0f,0f,0f,0f]`;
const nbt = (tag, s) => `{NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["${tag}"],Attributes:[{Name:"minecraft:generic.max_health",Base:100d}],Health:100f${s.targetArmor ? ',' + armorNbt(s.targetArmor) : ''}}`;
async function main() {
  const workDir = process.env.MCLITE_PMELEE_WORKDIR || join(homedir(), '.mclite-referee-pmelee');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25675, rconPort: 26675, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { lost: [], lost2: [] };
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    // NIGHT: a NoAI zombie still burns by day (1 per 20 ticks — that noise was the first run's), 18000 = midnight.
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 16 16',
      `fill -4 ${FLOOR - 1} -4 4 ${FLOOR + 4} 6 minecraft:air`, `fill -4 ${FLOOR - 1} -4 4 ${FLOOR - 1} 6 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'pm0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival pm0');
    await C(`tp pm0 0.5 ${FLOOR} 0.5 0 0`);
    let mode = 'stand';
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await sleep(3500);
    const health = async (tag) => { const m = /data:\s*([-0-9.Ee]+)f/.exec(await C(`data get entity @e[tag=${tag},limit=1] Health`)); return m ? parseFloat(m[1]) : NaN; };
    for (const s of SCEN) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('kill @e[type=!player]');
        await C('clear pm0');
        await C('effect clear pm0');
        if (s.weapon) await C(`item replace entity pm0 weapon.mainhand with ${itemArg(s.weapon)}`);
        if (s.effect) await C(`effect give pm0 minecraft:${s.effect[0]} 1000 ${s.effect[1]} true`);
        await sleep(200);
        const n0 = bot.spawnedIds.length;
        await C(`summon minecraft:${s.target} 0.5 ${FLOOR} ${0.5 + DZ} ${nbt('tg', s)}`);
        if (s.sweep) await C(`summon minecraft:${s.target} ${0.5 + SWEEP_DX} ${FLOOR} ${0.5 + DZ} ${nbt('tn', s)}`);
        await sleep(1800);
        const ids = bot.spawnedIds.slice(n0);
        if (!ids.length) { notes.push(`${s.id} rep ${rep}: no spawn id seen`); cases[s.id].lost.push(null); continue; }
        const b = await health('tg'), b2 = s.sweep ? await health('tn') : null;
        if (s.crit) { mode = 'crit'; bot.sendPos(0.5, FLOOR + 0.3, 0.5, false); bot.sendPos(0.5, FLOOR + 0.2, 0.5, false); }
        bot.attack(ids[0]);
        if (s.crit) { bot.sendPos(0.5, FLOOR, 0.5, true); mode = 'stand'; }
        await sleep(600);
        cases[s.id].lost.push(Math.round((b - await health('tg')) * 1e5) / 1e5);
        if (s.sweep) cases[s.id].lost2.push(Math.round((b2 - await health('tn')) * 1e5) / 1e5);
      }
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(24)} lost ${c.lost.join('/')}${s.sweep ? '  neighbour ' + c.lost2.join('/') : ''}`); }
  const golden = { pack: 'player-melee', version: '1.18.2', REPS, clock: 'growbot survival, weapon by /item replace, NBT NoAI target (max health 100) 2 blocks +z, > 1.5 s, one Attack packet, 0.6 s, Health lost',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-melee.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runpmelee: ${golden.seconds} s -> ${join(dir, 'player-melee.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
