#!/usr/bin/env node
// runpcool.mjs — the referee's PLAYER ATTACK COOLDOWN runner (infra I6, 25 Sept 2026). Scenarios: pcoolscen.mjs.
//   node tools/referee/runpcool.mjs     (~11 scenes x REPS x ~3 s)
// ONE growbot survival player (confirmTeleports + captureVelocity); per scene/rep: every non-player entity killed, weapons by
// /item replace (hotbar.0, hotbar.1 for a switch scene), slot 0 selected, targets A/B(/N) summoned WITH NBT (NoAI, max health
// 100), > 1.8 s so the cooldown is full; then the emptying packet(s) (attack A | hand swing | held-item change), `gap` ms, the
// Attack packet on B, 0.6 s, Health lost by A, B (and N) read back.
// Own port 25731 + work dir (MCLITE_PCOOL_WORKDIR, default ~/.mclite-referee-pcool); golden -> <referee dir>/golden/player-cooldown.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, REPS, DZ, AX, BX, NX } from './pcoolscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const itemArg = (a) => `minecraft:${a.item}${a.ench ? `{Enchantments:[${a.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}`;
const nbt = (tag) => `{NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["${tag}"],Attributes:[{Name:"minecraft:generic.max_health",Base:100d}],Health:100f}`;
async function main() {
  const workDir = process.env.MCLITE_PCOOL_WORKDIR || join(homedir(), '.mclite-referee-pcool');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25731, rconPort: 26731, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { lostA: [], lostB: [], lostN: [] };
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 16 16',
      `fill -5 ${FLOOR - 1} -4 5 ${FLOOR + 4} 6 minecraft:air`, `fill -5 ${FLOOR - 1} -4 5 ${FLOOR - 1} 6 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'pc0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival pc0');
    await C(`tp pc0 0.5 ${FLOOR} 0.5 0 0`);
    let mode = 'stand';
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await sleep(3500);
    const health = async (tag) => { const m = /data:\s*([-0-9.Ee]+)f/.exec(await C(`data get entity @e[tag=${tag},limit=1] Health`)); return m ? parseFloat(m[1]) : NaN; };
    const r5 = (v) => Math.round(v * 1e5) / 1e5;
    for (const s of SCEN) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('kill @e[type=!player]');
        await C('clear pc0');
        bot.selectSlot(0);
        if (s.weapon) await C(`item replace entity pc0 hotbar.0 with ${itemArg(s.weapon)}`);
        if (s.weapon2) await C(`item replace entity pc0 hotbar.1 with ${itemArg(s.weapon2)}`);
        const n0 = bot.spawnedIds.length;
        await C(`summon minecraft:zombie ${0.5 + AX} ${FLOOR} ${0.5 + DZ} ${nbt('ta')}`);
        await sleep(150);
        const n1 = bot.spawnedIds.length;
        await C(`summon minecraft:zombie ${0.5 + BX} ${FLOOR} ${0.5 + DZ} ${nbt('tb')}`);
        if (s.sweep) await C(`summon minecraft:zombie ${0.5 + NX} ${FLOOR} ${0.5 + DZ} ${nbt('tn')}`);
        await sleep(1900);
        const idA = bot.spawnedIds[n0], idB = bot.spawnedIds[n1];
        if (idA === undefined || idB === undefined || n1 !== n0 + 1) { notes.push(`${s.id} rep ${rep}: spawn ids not seen in order`); continue; }
        if (s.crit) { mode = 'crit'; bot.sendPos(0.5, FLOOR + 0.3, 0.5, false); bot.sendPos(0.5, FLOOR + 0.2, 0.5, false); }
        if (s.empty === 'hit') bot.attack(idA);
        else if (s.empty === 'swing') bot.swing(0);
        else if (s.empty === 'switch') bot.selectSlot(1);
        if (s.gap) await sleep(s.gap);
        bot.attack(idB);
        if (s.crit) { bot.sendPos(0.5, FLOOR, 0.5, true); mode = 'stand'; }
        await sleep(600);
        const c = cases[s.id];
        c.lostA.push(r5(100 - await health('ta')));
        c.lostB.push(r5(100 - await health('tb')));
        if (s.sweep) c.lostN.push(r5(100 - await health('tn')));
      }
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(28)} A ${c.lostA.join('/')}  B ${c.lostB.join('/')}${s.sweep ? '  N ' + c.lostN.join('/') : ''}`); }
  const golden = { pack: 'player-cooldown', version: '1.18.2', REPS, clock: 'growbot survival, weapons by /item replace, NBT NoAI zombies (max health 100), > 1.9 s, emptying packet(s), gap ms, Attack on B, 0.6 s, Health lost',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-cooldown.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runpcool: ${golden.seconds} s -> ${join(dir, 'player-cooldown.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
