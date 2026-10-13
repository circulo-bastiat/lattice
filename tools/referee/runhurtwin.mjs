#!/usr/bin/env node
// runhurtwin.mjs — the referee's HURT-WINDOW runner (infra I6, s149). Scenes: hurtwinscen.mjs.
// One growbot survival player + one NoAI iron golem take the SAME instant_damage hits at exact
// tick offsets: a datapack chains `schedule function ... <dt>t` so the gaps are tick-exact (RCON
// round trips are not). Each rep: player back to full with an amplified instant_health (a player
// refuses /data merge — runpotion.mjs's note), golem killed and re-summoned, 2 s so every window
// has closed; then the chain; then Health read after SETTLE ticks. naturalRegeneration off.
//
//   node tools/referee/runhurtwin.mjs        (~1 min)
//
// Own port 25853 / rcon 26853, work dir $MCLITE_HURTWIN_WORKDIR or ~/.mclite-referee-hurtwin;
// golden -> golden/hurt-window.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENES, REPS, SETTLE } from './hurtwinscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PX = 10.5, PZ = 0.5, GX = 16.5;

async function writeDatapack(workDir) {
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitehw');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'hw', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee hurt window' } }));
  for (const s of SCENES) {
    s.hits.forEach(([t, amp], i) => {
      const lines = [`effect give hw0 minecraft:instant_damage 1 ${amp} true`,
        `effect give @e[tag=hwg] minecraft:instant_damage 1 ${amp} true`];
      if (i + 1 < s.hits.length) lines.push(`schedule function hw:${s.id}_${i + 1} ${s.hits[i + 1][0] - t}t`);
      writeFileSync(join(fdir, `${s.id}_${i}.mcfunction`), lines.join('\n') + '\n');
    });
  }
}

async function main() {
  const workDir = process.env.MCLITE_HURTWIN_WORKDIR || join(homedir(), '.mclite-referee-hurtwin');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  await writeDatapack(workDir);
  const server = await startServer({ workDir, port: 25853, rconPort: 26853, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 40 16',
      'datapack enable "file/mclitehw"']) await C(c);
    const probe = await C('function hw:one_0');   // also proves the datapack loaded (player absent → "No entity was found" is fine)
    if (/Unknown function/i.test(probe)) throw new Error('datapack not loaded: ' + probe);
    await C('fill -12 -17 -4 34 -12 4 minecraft:air');
    await C('fill -12 -17 -4 34 -17 4 minecraft:stone');
    await sleep(800);
    bot = await connectFakePlayer({ port: server.port, name: 'hw0', confirmTeleports: true });
    await sleep(1000);
    await C('gamemode survival hw0');
    await C(`tp hw0 ${PX} -16 ${PZ} 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(PX, -16, PZ, true); }, 50);
    await sleep(1500);
    const health = async (sel) => { const m = /Health:\s*([-0-9.Ee]+)f/.exec(await C(`data get entity ${sel} Health`)) || /([-0-9.]+)f?\s*$/.exec(await C(`data get entity ${sel} Health`)); return m ? parseFloat(m[1]) : NaN; };
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    for (const s of SCENES) {
      const player = [], golem = [], wall = [];
      for (let r = 0; r < REPS; r++) {
        await C('effect clear hw0');
        await C('effect give hw0 minecraft:instant_health 1 10 true');
        await C('kill @e[tag=hwg]');
        await C(`summon minecraft:iron_golem ${GX} -16 ${PZ} {NoAI:1b,PersistenceRequired:1b,Tags:["hwg"]}`);
        await sleep(2000);
        const p0 = await health('hw0'), g0 = await health('@e[tag=hwg,limit=1]');
        const gt0 = await gametime();
        // the FIRST hit also goes through `schedule` (not straight from RCON): an RCON command runs between ticks and a
        // scheduled one at the start of a tick, so mixing them shifts the first gap by one tick (seen: 'inc10' read as 9).
        await C(`schedule function hw:${s.id}_0 1t`);
        const last = s.hits[s.hits.length - 1][0];
        let gt = gt0;
        await sleep((last + SETTLE) * 50 + 300);
        for (let k = 0; k < 40 && (gt = await gametime()) < gt0 + last + SETTLE; k++) await sleep(100);
        const p1 = await health('hw0'), g1 = await health('@e[tag=hwg,limit=1]');
        player.push(Math.round((p0 - p1) * 1000) / 1000); golem.push(Math.round((g0 - g1) * 1000) / 1000); wall.push(gt - gt0);
        if (p0 !== 20 || g0 !== 100) notes.push(`${s.id} rep ${r}: start health player ${p0} golem ${g0}`);
      }
      cases[s.id] = { hits: s.hits, player, golem, ticksToRead: wall };
      console.log(`  ${s.id.padEnd(8)} player ${JSON.stringify(player)} golem ${JSON.stringify(golem)}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'hurt-window', version: '1.18.2',
    clock: 'datapack schedule chain (tick-exact gaps); growbot survival player hw0 + NoAI iron golem, instant_damage via /effect give (magic, 6<<amp), full reset + 2 s between reps, Health read >= SETTLE ticks after the last hit',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hurt-window.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runhurtwin: ${golden.seconds} s -> ${join(dir, 'hurt-window.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
