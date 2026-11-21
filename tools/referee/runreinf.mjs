#!/usr/bin/env node
// runreinf.mjs — the referee's ZOMBIE REINFORCEMENTS runner (infra I6, s152). Scenes: reinfscen.mjs. One survival growbot
// punches (Interact-Entity attack packet, bare hand) a NoAI caller once per rep; 2 s later the new zombies/husks in the
// arena are counted, typed and located, and the caller's zombie.spawn_reinforcements is read with /attribute.
//
//   node tools/referee/runreinf.mjs       (~4 min)
//
// Own port 25895 / rcon 26895, work dir $MCLITE_REINF_WORKDIR or ~/.mclite-referee-reinf; golden -> golden/zombie-reinf.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { Y, HALF, DZ, SWEEP_DX, SCENES } from './reinfscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const workDir = process.env.MCLITE_REINF_WORKDIR || join(homedir(), '.mclite-referee-reinf');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25895, rconPort: 26895, xmx: '1280M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning true', 'gamerule doWeatherCycle false',
      'weather clear', 'gamerule doPatrolSpawning false', 'gamerule doTraderSpawning false', 'gamerule doInsomnia false',
      'gamerule doMobLoot false', 'gamerule mobGriefing false', 'difficulty hard', `forceload add -${HALF + 8} -${HALF + 8} ${HALF + 8} ${HALF + 8}`]) await C(c);
    const roof = async (block) => { for (let x0 = -HALF; x0 <= HALF; x0 += 32) await C(`fill ${x0} ${Y + 2} -${HALF} ${Math.min(HALF, x0 + 31)} ${Y + 2} ${HALF} minecraft:${block}`); };
    await roof('stone');
    bot = await connectFakePlayer({ port: server.port, name: 'rf0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival rf0');
    await C(`tp rf0 0.5 ${Y} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, Y, 0.5, true); }, 50);
    await C('effect give rf0 minecraft:resistance 100000 4 true');
    await sleep(2500);
    const val = (r) => { const m = /is (-?[0-9.Ee-]+)\s*$/.exec(r.trim()); return m ? parseFloat(m[1]) : null; };
    const count = async (sel) => { const m = /count: (\d+)/.exec(await C(`execute if entity ${sel}`)); return m ? +m[1] : 0; };
    for (const s of SCENES) {
      await C(`difficulty ${s.diff}`);
      await C(`gamerule doMobSpawning ${s.noSpawn ? 'false' : 'true'}`);
      if (s.open) { await roof('air'); await C('time set 6000'); }
      const c = cases[s.id] = { mob: s.mob, diff: s.diff, base: s.base, reps: [] };
      for (let rep = 0; rep < s.reps; rep++) {
        await C('kill @e[type=!player]');
        await C(`tp rf0 0.5 ${Y} 0.5 0 0`);
        await sleep(300);
        await C(`item replace entity rf0 weapon.mainhand with ${s.sweep ? 'minecraft:diamond_sword' : 'minecraft:air'}`);
        const n0 = bot.spawnedIds.length;
        if (s.sweep) await C(`summon minecraft:pig 0.5 ${Y} ${0.5 + DZ} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["caller"],Health:100f,Attributes:[{Name:"minecraft:generic.max_health",Base:100d}]}`);
        const r = await C(`summon minecraft:${s.mob} ${0.5 + (s.sweep ? SWEEP_DX : 0)} ${Y} ${0.5 + DZ} {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["caller"],Health:100f,` +
          `Attributes:[{Name:"minecraft:generic.max_health",Base:100d},{Name:"minecraft:zombie.spawn_reinforcements",Base:${s.base}d}]}`);
        if (!/Summoned/i.test(r)) notes.push(`${s.id}: summon said ${r.trim()}`);
        await sleep(1200);
        const ids = bot.spawnedIds.slice(n0);
        if (!ids.length) { notes.push(`${s.id} rep ${rep}: no spawn id seen`); continue; }
        bot.attack(ids[0]);
        await sleep(1500);
        const zombies = await count('@e[type=minecraft:zombie,tag=!caller]');
        const husks = await count('@e[type=minecraft:husk,tag=!caller]');
        const others = await count('@e[type=!minecraft:player,tag=!caller]');
        let dist = null, callee = null;
        if (zombies + husks > 0) {
          const pm = /\[(-?[0-9.]+)d, (-?[0-9.]+)d, (-?[0-9.]+)d\]/.exec(await C('data get entity @e[tag=!caller,type=!player,limit=1] Pos'));
          if (pm) dist = Math.round(Math.hypot(+pm[1] - 0.5, +pm[3] - (0.5 + DZ)) * 100) / 100;
          callee = val(await C('attribute @e[tag=!caller,type=!player,limit=1] minecraft:zombie.spawn_reinforcements get'));
        }
        const hm = /data:\s*([-0-9.Ee]+)f/.exec(await C(`data get entity @e[tag=caller,type=minecraft:${s.mob},limit=1] Health`));
        const caller = val(await C(`attribute @e[tag=caller,type=minecraft:${s.mob},limit=1] minecraft:zombie.spawn_reinforcements get`));
        c.reps.push({ zombies, husks, others, dist, caller, callee, hit: hm ? 100 - parseFloat(hm[1]) : null });
      }
      const n = c.reps.length, got = c.reps.filter((q) => q.zombies + q.husks > 0).length;
      console.log(`  ${s.id.padEnd(22)} ${got}/${n} called · zombies ${c.reps.reduce((a, q) => a + q.zombies, 0)} husks ${c.reps.reduce((a, q) => a + q.husks, 0)} · dist ${c.reps.filter((q) => q.dist !== null).map((q) => q.dist).join(',')} · caller ${[...new Set(c.reps.map((q) => q.caller))].join('/')} · hit ${[...new Set(c.reps.map((q) => q.hit))].join('/')}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'zombie-reinf', version: '1.18.2', generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'zombie-reinf.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runreinf: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${join(dir, 'zombie-reinf.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
