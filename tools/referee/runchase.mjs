#!/usr/bin/env node
// runchase.mjs — infra I6 (25 Sept 2026): golden for chaserefcheck.mjs — MOB CHASE SPEED on the real 1.18.2 server.
// Scenarios: chasescen.mjs. One lane per mob (stone corridor), one growbot survival player per lane standing still
// (resistance 255, so nothing dies), the mob summoned START blocks from it (AI on, persistent, NBT form -> no gear).
// A datapack TICK function appends the mob's Pos to storage every tick (tick-exact: the function runs before the
// worlds tick, so entry i = the position after i world ticks, entry 0 = the summon position). Own port 25671.
//   node tools/referee/runchase.mjs        (~REPS x 10 s of game time + ~40 s of setup)
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee, resolveBusyPort } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { LIVE as CHASE_LANES, LOCKSTEP_ONLY, START, T, PITCH, REPS, DIST, startX, playerX } from './chasescen.mjs';

// MCLITE_CHASE_ONLY=zombie,... keeps just those lanes; MCLITE_CHASE_OUT redirects the golden (lockstep spike, #4986)
const ALL_LANES = process.env.MCLITE_CHASE_ONLY ? [...CHASE_LANES, ...LOCKSTEP_ONLY] : CHASE_LANES;
const LIVE = process.env.MCLITE_CHASE_ONLY ? ALL_LANES.filter((s) => process.env.MCLITE_CHASE_ONLY.split(',').includes(s.id)) : ALL_LANES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: the lane's stone floor replaces it
const PATHLOG = process.env.MCLITE_LOCKSTEP_PATHLOG || '';   // #6952
const botName = (k) => 'chase' + k;

export function parsePosList(reply) {
  const nums = (reply.match(/-?\d+(?:\.\d+)?(?:E-?\d+)?d/g) || []).map((q) => parseFloat(q));
  const out = [];
  for (let i = 0; i + 2 < nums.length; i += 3) out.push([nums[i], nums[i + 1], nums[i + 2]]);
  return out;
}

async function main() {
  // a busy port moves the server to <workDir>-p<port> (#6426): resolve it first so the datapack is written where the server runs
  const want = await resolveBusyPort({ port: +process.env.MCLITE_CHASE_PORT || 25671, rconPort: +process.env.MCLITE_CHASE_RCON || 26671, workDir: process.env.MCLITE_CHASE_WORKDIR || join(homedir(), '.mclite-referee-chase') });
  const workDir = want.workDir;
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitechase');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitechase', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee chase' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitechase:tick'] }));
  const Z = (k) => k * PITCH;
  const arena = [], spawn = [], log = [], itemFns = [], projFns = [];
  LIVE.forEach((s, k) => {
    const z = Z(k);
    if (s.open) arena.push(`fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR + 20} ${z + 3} minecraft:air`, `fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR - 1} ${z + 3} minecraft:stone`);   // #5362: ghast lane, open air over a floor
    else arena.push(`fill -4 ${FLOOR - 1} ${z - 3} ${DIST + 4} ${FLOOR + 3} ${z + 3} minecraft:air`,
      `fill -4 ${FLOOR - 1} ${z - 1} ${DIST + 4} ${FLOOR - 1} ${z + 1} minecraft:stone`,
      `fill -4 ${FLOOR} ${z - 2} ${DIST + 4} ${FLOOR + 1} ${z - 2} minecraft:stone`,
      `fill -4 ${FLOOR} ${z + 2} ${DIST + 4} ${FLOOR + 1} ${z + 2} minecraft:stone`,
      `fill -4 ${FLOOR} ${z - 1} -4 ${FLOOR + 1} ${z + 1} minecraft:stone`,
      `fill ${DIST + 4} ${FLOOR} ${z - 1} ${DIST + 4} ${FLOOR + 1} ${z + 1} minecraft:stone`);
    if (s.wall) arena.push(`fill ${START + 5} ${FLOOR} ${z - 1} ${START + 5} ${FLOOR} ${z} minecraft:stone`);
    if (s.pool) arena.push(`fill -3 ${FLOOR} ${z - 1} ${DIST + 3} ${FLOOR + 1} ${z + 1} minecraft:water`);
    if (s.motion) spawn.push(`data modify storage mclite:chase m${k} set value {vel:[],rot:[],air:[]}`);
    spawn.push(`data modify storage mclite:chase l${k} set value []`,
      `summon minecraft:${s.mob} ${startX()} ${FLOOR + (s.up || 0)} ${z + 0.5} {PersistenceRequired:1b,Tags:["ch${k}","chase"]${s.nbt ? ',' + s.nbt : ''}}`);
    log.push(`data modify storage mclite:chase l${k} append from entity @e[tag=ch${k},limit=1] Pos`);
    if (s.motion) log.push(`data modify storage mclite:chase m${k}.vel append from entity @e[tag=ch${k},limit=1] Motion`,
      `data modify storage mclite:chase m${k}.rot append from entity @e[tag=ch${k},limit=1] Rotation`,
      `data modify storage mclite:chase m${k}.air append from entity @e[tag=ch${k},limit=1] Air`);
    if (s.fire) {   // #5362: ghast -- Rotation per tick; each new fireball (Age-independent: tagged once seen) logs {tick, Pos, Motion}
      spawn.push(`data modify storage mclite:chase f${k} set value {rot:[],ftick:[],fpos:[],fmot:[]}`);
      log.push(`data modify storage mclite:chase f${k}.rot append from entity @e[tag=ch${k},limit=1] Rotation`,
        `execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=fireball,tag=!seen${k}] run function mclitechase:fire${k}`);
      itemFns.push(`data modify storage mclite:chase f${k}.ftick append from storage mclite:chase tk`,
        `data modify storage mclite:chase f${k}.fpos append from entity @s Pos`, `data modify storage mclite:chase f${k}.fmot append from entity @s Motion`, `tag @s add seen${k}`);
    }
    if (s.ent) {   // #6356: ENT walk -- chicken EggLayTime/Age per tick; each new item entity (Age:0s) logs {tick, Pos}
      spawn.push(`data modify storage mclite:chase e${k} set value {egg:[],age:[],itick:[],ipos:[]}`);
      log.push(`data modify storage mclite:chase e${k}.egg append from entity @e[tag=ch${k},limit=1] EggLayTime`,
        `data modify storage mclite:chase e${k}.age append from entity @e[tag=ch${k},limit=1] Age`,
        `execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=item,nbt={Age:0s},tag=!seen${k}] run function mclitechase:item${k}`);
      itemFns.push(`data modify storage mclite:chase e${k}.itick append from storage mclite:chase tk`,
        `data modify storage mclite:chase e${k}.ipos append from entity @s Pos`, `tag @s add seen${k}`);
    }
    if (s.proj) {   // #5361: PROJ walk -- each new fireball (tag-less, !seen) logs {tick, Pos, Motion}
      spawn.push(`data modify storage mclite:chase p${k} set value {tick:[],pos:[],mot:[]}`);
      log.push(`execute store result storage mclite:chase tk int 1 run scoreboard players get #t mc`,
        `execute as @e[type=minecraft:${s.projType || 'small_fireball'},tag=!seen${k}] run function mclitechase:proj${k}`);
      projFns.push(`data modify storage mclite:chase p${k}.tick append from storage mclite:chase tk`,
        `data modify storage mclite:chase p${k}.pos append from entity @s Pos`, `data modify storage mclite:chase p${k}.mot append from entity @s Motion`, `tag @s add seen${k}`);
    }
  });
  spawn.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1');
  // #6623: lockstep arms the spawn for a tick whose gametime % 20 == 0. MeleeAttackGoal/ActiveTarget cooldowns are gametime-phased
  // (lastUpdateTime), so a summon at a wall-clock-random phase moved the zombie's first step by a tick between two fresh runs.
  const tick = ['scoreboard players set #20 mc 20', 'execute store result score #g mc run time query gametime', 'scoreboard players operation #g mc %= #20 mc',
    'execute if score #arm mc matches 1 if score #g mc matches 0 run function mclitechase:spawn', 'execute if score #arm mc matches 1 if score #g mc matches 0 run scoreboard players set #arm mc 0',
    'execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitechase:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  LIVE.forEach((s, k) => {
    if (s.fire) writeFileSync(join(fdir, `fire${k}.mcfunction`), itemFns.splice(0, 4).join('\n') + '\n');
    if (s.ent) writeFileSync(join(fdir, `item${k}.mcfunction`), itemFns.splice(0, 3).join('\n') + '\n');
  });
  LIVE.forEach((s, k) => { if (s.proj) writeFileSync(join(fdir, `proj${k}.mcfunction`), projFns.splice(0, 4).join('\n') + '\n'); });
  writeFileSync(join(fdir, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: want.port, rconPort: want.rconPort, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of LIVE) cases[s.id] = { mob: s.mob, nbt: s.nbt || '', creative: !!s.creative, logs: [] };
  let rcon; const bots = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0',
      ]) await C(c);
    // forceload refuses more than 256 chunks per command: add the lanes in slices of 20 (5 x ~31 chunks each)
    for (let k0 = 0; k0 < LIVE.length; k0 += 20) {
      const r = await C(`forceload add -16 ${Z(k0) - 16} 48 ${Z(Math.min(k0 + 20, LIVE.length)) + 16}`);
      if (/too many|No chunks|Unable/i.test(r)) throw new Error('forceload: ' + r);
    }
    const a = await C('function mclitechase:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    for (let k = 0; k < LIVE.length; k++) {
      bots.push(await connectFakePlayer({ port: server.port, name: botName(k) }));
      await C(`gamemode ${LIVE[k].creative ? 'creative' : 'survival'} ${botName(k)}`);
      await C(`effect give ${botName(k)} minecraft:resistance 1000000 255 true`);
      await C(`tp ${botName(k)} ${playerX()} ${FLOOR} ${Z(k) + 0.5} 90 0`);
    }
    await sleep(1000);
    for (let rep = 0; rep < REPS; rep++) {
      if (process.env.MCLITE_LOCKSTEP_RESET) writeFileSync(process.env.MCLITE_LOCKSTEP_RESET, 'rep' + rep);   // #6225: SeedAgent restarts its per-class counters
      if (PATHLOG) writeFileSync(PATHLOG, '');
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      for (let k = 0; k < LIVE.length; k++) await C(`tp ${botName(k)} ${playerX()} ${FLOOR} ${Z(k) + 0.5} 90 0`);
      await sleep(300);
      if (process.env.MCLITE_LOCKSTEP_RESET) { await C('scoreboard players set #arm mc 1'); await sleep(1500); } else await C('function mclitechase:spawn');
      await sleep(T * 50 + 1000);
      let tNow = 0;
      for (let i = 0; i < 40; i++) {                     // bounded: our own server catching up (D-436 allows this)
        tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow}/${T} ticks ran`);
      for (let k = 0; k < LIVE.length; k++) {
        const L = parsePosList(await C(`data get storage mclite:chase l${k}`));
        const z0 = Z(k);
        cases[LIVE[k].id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (LIVE[k].motion) {
          const mv = await C(`data get storage mclite:chase m${k}`), grp = (key) => ((new RegExp(key + ': \\[(.*?)\\](?=, [a-z]+:|\\}|$)', 's').exec(mv) || [0, ''])[1]);
          const nums = (t) => (t.match(/-?\d+(?:\.\d+)?(?:[eE]-?\d+)?[dDfFsS]?/g) || []).map(parseFloat);
          (cases[LIVE[k].id].extra = cases[LIVE[k].id].extra || []).push({ vel: nums(grp('vel')), rot: nums(grp('rot')), air: nums(grp('air')) });
        }
        if (LIVE[k].fire) {
          const ev = await C(`data get storage mclite:chase f${k}`);
          if (process.env.MCLITE_FIRE_DEBUG) console.log("FIREDATA", ev.slice(-600));
          const sect = (key) => ((new RegExp(key + ': \\[(.*?)\\](?:, [a-z]+:|\\}|$)').exec(ev) || [0, ''])[1]);
          (cases[LIVE[k].id].fire = cases[LIVE[k].id].fire || []).push({ rot: (sect('rot').match(/-?\d+(?:\.\d+)?(?:E-?\d+)?f/g) || []).map(parseFloat), fireTick: (sect('ftick').match(/-?\d+/g) || []).map(Number), firePos: parsePosList(sect('fpos')), fireMotion: parsePosList(sect('fmot')) });
        }
        if (LIVE[k].ent) {
          const ev = await C(`data get storage mclite:chase e${k}`);
          const ints = (key) => ((new RegExp(key + ': \\[([^\\]]*)\\]').exec(ev) || [0, ''])[1].match(/-?\d+/g) || []).map(Number);
          (cases[LIVE[k].id].ent = cases[LIVE[k].id].ent || []).push({ eggLayTime: ints('egg'), age: ints('age'), itemTick: ints('itick'), itemPos: parsePosList(((/ipos: (\[.*\]\]?)/.exec(ev) || [0, ''])[1])) });
        }
        if (LIVE[k].proj) {   // #5361
          const ev = await C(`data get storage mclite:chase p${k}`);
          const all = parsePosList(((/pos: (\[.*?\]\]?), mot/.exec(ev) || [0, ''])[1]));
          (cases[LIVE[k].id].proj = cases[LIVE[k].id].proj || []).push({ tick: ((/tick: \[([^\]]*)\]/.exec(ev) || [0, ''])[1].match(/-?\d+/g) || []).map(Number),
            pos: all.map(([x, y, z]) => [x, y - FLOOR, z - z0]), motion: parsePosList(((/mot: (\[.*\]\]?)/.exec(ev) || [0, ''])[1])) });
        }
        if (PATHLOG) {   // #6952: SeedAgent's 'PATH <gen> <tick> <nodes>' lines -> cases[id].paths[rep][tick] = [[x,y,z],..] (lane-local) | null
          const P = Array.from({ length: T }, () => null);
          for (const ln of (existsSync(PATHLOG) ? readFileSync(PATHLOG, 'utf8') : '').split('\n')) {
            const m = /^PATH (\S*) (\d+) (\S+)$/.exec(ln);
            if (!m || +m[2] >= T) continue;
            P[+m[2]] = m[3] === '-' ? null : m[3].split(';').map((q) => { const [x, y, z] = q.split(',').map(Number); return [x, y - FLOOR, z - z0]; });
          }
          (cases[LIVE[k].id].paths = cases[LIVE[k].id].paths || []).push(P);
        }
        if (L.length !== T) notes.push(`rep ${rep} ${LIVE[k].id}: ${L.length}/${T} samples (mob gone?)`);
      }
    }
  } finally {
    for (const b of bots) { try { b.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'chase', version: '1.18.2', T, REPS, clock: 'summon (AI on, persistent, NBT form) -> tick function logs Pos before each world tick; entry i = after i world ticks; positions local (x along the lane, y above the floor, z across)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(process.env.MCLITE_CHASE_OUT || join(dir, 'chase.json'), JSON.stringify(golden) + '\n');
  for (const s of LIVE) { const L = cases[s.id].logs[0] || []; console.log(`  ${s.id.padEnd(16)} x@40 ${(L[40] || [])[0]}  x@80 ${(L[80] || [])[0]}  x@159 ${(L[159] || [])[0]}`); }
  console.log(`referee/runchase: ${golden.seconds} s -> ${join(dir, 'chase.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
