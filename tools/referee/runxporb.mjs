#!/usr/bin/env node
// runxporb.mjs — #6086: golden for xporbrefcheck.mjs, the real 1.18.2 server's XP ORB pull/merge/pickup (xporbscen.mjs).
// Growbot players (own port 25673), one per lane; a tick function logs per lane: orb count, first orb's Count, its Pos,
// the player's XpTotal. Golden: <referee dir>/golden/xp-orb.json
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENES, PROBES, T, SCALE, PITCH, FLOOR, origin } from './xporbscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bot = (k) => 'xob' + k;

async function main() {
  const workDir = process.env.MCLITE_XORB_WORKDIR || join(homedir(), '.mclite-referee-xporb');
  const dp = join(workDir, 'world', 'datapacks', 'mclitexo');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitexo', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee xp orb' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitexo:gate'] }));
  const step = ['scoreboard players add #t mcx 1'];
  const arena = [];
  SCENES.forEach((sc, k) => {
    const o = origin(k), sel = `@e[type=experience_orb,tag=xo${k},limit=1]`, st = `mclitexo:l${k}`;
    arena.push(`fill -4 ${FLOOR - 1} ${o.z - 6} 60 ${FLOOR + 8} ${o.z + 6} minecraft:air`, `fill -4 ${FLOOR - 1} ${o.z - 6} 60 ${FLOOR - 1} ${o.z + 6} minecraft:stone`);
    for (const orb of sc.orbs) step.push(`execute if score #t mcx matches 1 run summon minecraft:experience_orb ${o.x + orb.pos[0]} ${o.y + orb.pos[1]} ${o.z + orb.pos[2]} {Value:${orb.value}s,Motion:[0d,0d,0d],Tags:["xo${k}"]}`);
    PROBES.forEach((p) => step.push(`data modify storage mclitexo:s ${p}${k} append value 0${["x", "y", "z"].includes(p) ? "d" : ""}`));
    step.push(`execute store result storage mclitexo:s n${k}[-1] int 1 if entity @e[type=experience_orb,tag=xo${k}]`);
    step.push(`execute store result storage mclitexo:s cnt${k}[-1] int 1 run data get entity ${sel} Count`);
    ['x', 'y', 'z'].forEach((a, i) => step.push(`execute store result storage mclitexo:s ${a}${k}[-1] double 1 run data get entity ${sel} Pos[${i}] ${SCALE}`));
    step.push(`execute store result storage mclitexo:s xp${k}[-1] int 1 run data get entity ${bot(k)} XpTotal`);
    if (sc.step) step.push(`execute as ${bot(k)} at @s run tp @s ~${sc.step} ~ ~`);
  });
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mcx matches 1 if score #t mcx matches ..${T - 1} run function mclitexo:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), step.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25673, rconPort: 26673, xmx: '1536M' });
  const cases = {}, notes = [], bots = [];
  let rcon; const t0 = Date.now();
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty peaceful', 'gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false',
      'scoreboard objectives add mcx dummy', 'scoreboard players set #run mcx 0', 'scoreboard players set #t mcx 0']) await C(c);
    await C('kill @e[type=experience_orb]');
    await C(`forceload add -16 -16 64 ${SCENES.length * PITCH + 16}`);
    if (/Unknown function/i.test(await C('function mclitexo:arena'))) throw new Error('datapack not loaded');
    for (let k = 0; k < SCENES.length; k++) {
      bots.push(await connectFakePlayer({ port: server.port, name: bot(k) }));
      await C(`gamemode ${SCENES[k].mode} ${bot(k)}`);
      await C(`effect give ${bot(k)} minecraft:resistance 1000000 255 true`);
      await C(`xp set ${bot(k)} 0 levels`); await C(`xp set ${bot(k)} 0 points`);
      await C(`tp ${bot(k)} ${SCENES[k].px} ${FLOOR} ${k * PITCH + 0.5} 90 0`);
      for (const p of PROBES) await C(`data modify storage mclitexo:s ${p}${k} set value []`);
    }
    await sleep(1500);
    await C('kill @e[type=experience_orb]');
    await C('scoreboard players set #run mcx 1');
    await sleep(T * 50 + 1500);
    const tr = await C('scoreboard players get #t mcx');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await C('scoreboard players set #run mcx 0');
    for (let k = 0; k < SCENES.length; k++) {
      const c = cases[SCENES[k].id] = { probes: {} };
      for (const p of PROBES) {
        const m = /\[(.*)\]/.exec(await C(`data get storage mclitexo:s ${p}${k}`));
        c.probes[p] = m ? m[1].split(',').map((s) => Math.round(parseFloat(s))) : [];
        if (c.probes[p].length !== T) notes.push(`${SCENES[k].id}.${p}: ${c.probes[p].length}/${T} samples`);
      }
    }
  } finally {
    for (const b of bots) { try { b.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'xp-orb.json');
  writeFileSync(out, JSON.stringify({ pack: 'xp-orb', version: '1.18.2', T, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes }) + '\n');
  console.log(`referee/runxporb: ${SCENES.length} scenes in ${Math.round((Date.now() - t0) / 1000)} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
