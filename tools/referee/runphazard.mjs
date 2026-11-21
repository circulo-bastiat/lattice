#!/usr/bin/env node
// runphazard.mjs — the referee's PLAYER HAZARDS + PLAYER FALLS runner (infra I6, s143). Scenarios: phazardscen.mjs.
//   node tools/referee/runphazard.mjs      # 19 lanes x REPS, ~1 min
// Per rep: arena (1x1 glass pens; a fall lane is a glass tube with a glass platform under the bot's feet), one growbot PLAYER
// per lane (fresh names each rep, so none starts dead; `confirmTeleports` so its Player Position packets are honoured), each
// tagged pk<k>, survival, armour by /item replace, teleported onto its lane; every bot then reports its lane position every
// 50 ms (onGround true — a standing client). ONE function places every hazard block, removes every fall platform and resets
// the per-lane Health logs in the same server tick; from then on each fall bot's client plays phazardscen.clientFall one
// packet per 50 ms. A datapack tick function appends each lane's Health every tick (entry i = after i ticks). ONE bounded
// wait on the server WE started (not polling, D-436); read every log. Own port 25673 + work dir (MCLITE_PHAZARD_WORKDIR,
// default ~/.mclite-referee-phazard); golden -> <referee dir>/golden/player-hazards.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, REPS, PITCH, T, clientFall } from './phazardscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
const SLOT = ['armor.feet', 'armor.legs', 'armor.chest', 'armor.head'];
const itemArg = (a) => `minecraft:${a.item}${a.ench ? `{Enchantments:[${a.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}`;
async function main() {
  const workDir = process.env.MCLITE_PHAZARD_WORKDIR || join(homedir(), '.mclite-referee-phazard');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclph');
  rmSync(dp, { recursive: true, force: true });
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });   // a bot name that died last run rejoins dead
  const fdir = join(dp, 'data', 'mclph', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee player hazards' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclph:tick'] }));
  const X = (k) => k * PITCH;
  const arena = [], give = [], tick = [];
  SCEN.forEach((s, k) => {
    const x = X(k);
    const top = PAD + 3 + (s.fall || 0);
    arena.push(`fill ${x - 1} ${PAD} -1 ${x + 1} ${top} 1 minecraft:glass`, `fill ${x} ${PAD + 1} 0 ${x} ${top} 0 minecraft:air`,
      `setblock ${x} ${PAD} 0 minecraft:${s.floor === 'magma_block' ? 'stone' : s.floor}`);   // magma goes down at give time
    if (s.floor === 'magma_block') give.push(`setblock ${x} ${PAD} 0 minecraft:magma_block`);
    if (s.fall) arena.push(`setblock ${x} ${PAD + s.fall} 0 minecraft:glass`);
    if (s.at) give.push(`setblock ${x} ${PAD + 1} 0 minecraft:${s.at}`);
    if (s.head) give.push(`setblock ${x} ${PAD + 2} 0 minecraft:${s.head}`);
    if (s.fall) give.push(`setblock ${x} ${PAD + s.fall} 0 minecraft:air`);
    tick.push(`execute if score #on mclph matches 1 run data modify storage mclph:r l${k} append from entity @a[tag=pk${k},limit=1] Health`);
  });
  SCEN.forEach((s, k) => give.push(`data modify storage mclph:r l${k} set value []`));
  give.push('scoreboard players set #on mclph 1');
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'give.mcfunction'), give.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25673, rconPort: 26673, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { series: [], teleports: [] };
  let rcon;
  let bots = [];
  const loops = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'gamerule doImmediateRespawn false',
      'scoreboard objectives add mclph dummy', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    await sleep(1500);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #on mclph 0');
      await C('kill @e[type=!player]');
      const a = await C('function mclph:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded');
      await C('kill @e[type=item]');
      bots = [];
      for (let k = 0; k < SCEN.length; k++) {
        const name = `ph${rep}_${k}`;
        bots.push(await connectFakePlayer({ port: server.port, name, confirmTeleports: true }));
      }
      await sleep(1000);
      for (let k = 0; k < SCEN.length; k++) {
        const s = SCEN[k], name = `ph${rep}_${k}`, x = X(k) + 0.5, y = PAD + 1 + (s.fall || 0);
        await C(`tag ${name} add pk${k}`);
        await C(`gamemode survival ${name}`);
        await C(`clear ${name}`);
        await C(`effect clear ${name}`);
        for (const ar of s.armor) await C(`item replace entity ${name} ${SLOT[ar.slot]} with ${itemArg(ar)}`);
        await C(`tp ${name} ${x} ${y} 0.5 0 0`);
        const bot = bots[k];
        loops.push(setInterval(() => { if (!bot.closed && !bot.falling) bot.sendPos(x, y, 0.5, true); }, 50));
      }
      await sleep(4500);                                   // past the 60-tick join invulnerability (ServerPlayerEntity)
      for (let k = 0; k < SCEN.length; k++) await C(`effect give ph${rep}_${k} minecraft:instant_health 1 5 true`);
      await sleep(1200);                                   // > 20 ticks: no hurt-timer carries into the scene
      await C('function mclph:give');
      SCEN.forEach((s, k) => {
        if (!s.fall) return;
        const bot = bots[k], x = X(k) + 0.5, ys = clientFall(PAD + 1 + s.fall, PAD + 1);
        bot.falling = true;
        let i = 0;
        const t = setInterval(() => {
          if (bot.closed) { clearInterval(t); return; }
          if (i < ys.length) { bot.sendPos(x, ys[i], 0.5, i === ys.length - 1); i++; } else bot.sendPos(x, PAD + 1, 0.5, true);
        }, 50);
        loops.push(t);
      });
      await sleep(T * 50 + 1500);
      await C('scoreboard players set #on mclph 0');
      for (let k = 0; k < SCEN.length; k++) {
        const r = await C(`data get storage mclph:r l${k}`);
        const m = /\[(.*)\]/s.exec(r);
        const arr = m && m[1].trim() ? m[1].split(',').map((q) => parseFloat(q)) : [];
        cases[SCEN[k].id].series.push(arr.slice(0, T));
        cases[SCEN[k].id].teleports.push(bots[k].teleports);
      }
      while (loops.length) clearInterval(loops.pop());
      for (const b of bots) b.close();
      await sleep(1500);
    }
  } finally {
    while (loops.length) clearInterval(loops.pop());
    for (const b of bots) { try { b.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(22)} ${c.series.map((q) => `${q.length}t ${q[0]}->${q[q.length - 1]}`).join(' | ')}  tp ${c.teleports.join('/')}`); }
  const golden = { pack: 'player-hazards', version: '1.18.2', REPS, T, clock: 'growbot survival player per lane, standing (Player Position every 50 ms, teleports confirmed) -> hazards placed / fall platform removed (same tick as the log reset) -> Health every tick, entry 0 = before any world tick; falls driven client-side',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-hazards.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runphazard: ${golden.seconds} s -> ${join(dir, 'player-hazards.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
