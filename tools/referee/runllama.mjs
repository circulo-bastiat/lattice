#!/usr/bin/env node
// runllama.mjs — infra W-llama (25 Sept 2026): golden for llamarefcheck.mjs -- LLAMA SPIT vs WOLVES + WOLF AVOID
// LLAMA, on the real 1.18.2 server. Scenarios: llamascen.mjs (WILD: llama+wolf pair, varying Strength/distance;
// TAMED: same pair but the wolf is Owned; RETALIATE: a player hits a llama once).
//
// One pen per ENT scenario (stone floor + 2-high walls, mirrors avoidscen.mjs/panicscen.mjs): both mobs summoned
// AI-on/persistent/NBT-form (Strength via NBT, Owner via NBT for the tamed case -- neither needs `initialize()`,
// which a summon-with-NBT skips: `readCustomDataFromNbt` alone sets Strength/Owner+Tamed either way). A datapack
// TICK function logs every relevant mob's Pos + Health every tick (entry 0 = the summon tick, tick-exact) and
// tags every new `llama_spit` in that pen's own box with the gametime it first exists.
// The RETALIATE pen is a separate row: a growbot survival player (Resistance IV + Fire Resistance, re-healed) 2
// blocks from a llama (pmeleescen.mjs's own melee-reach distance), one real Attack packet, then the same
// llama_spit tagging for T ticks.
//
// Own port 25892 / rcon 26892, work dir $MCLITE_LLAMA_WORKDIR or ~/.mclite-referee-llama; golden -> golden/mob-llama.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { parsePosList } from './runchase.mjs';
import { T, REPS, R, PITCH, WILD, TAMED, ENT, RETALIATE, WOLF_HP, spitSummary } from './llamascen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                  // flat world's grass top is y -61: each pen's stone floor replaces it
const DEBUG = !!process.env.MCLITE_LLAMA_DEBUG;
const OWNER_UUID = '0,0,0,1';       // an arbitrary Owner UUID -- TameableEntity.readCustomDataFromNbt sets
                                     // Tamed=true off `containsUuid("Owner")` alone, no live player needed

async function main() {
  const workDir = process.env.MCLITE_LLAMA_WORKDIR || join(homedir(), '.mclite-referee-llama');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitellama');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitellama', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee llama' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitellama:tick'] }));

  const Z = (k) => k * PITCH;
  const retZ = 100000;              // the RETALIATE pen sits WAY outside every ENT pen's view distance -- the
                                     // bot's own spawnedIds (growbot.mjs, every visible living-entity spawn, no
                                     // type filter) must see ONLY this one llama, or bot.attack() below could hit
                                     // the wrong mob

  const arena = [], spawn = [], tick = [];
  const on = 'execute if score #on ll matches 1 ';
  const onT = `execute if score #on ll matches 1 if score #t ll matches ..${T - 1} `; // exact T-tick window, mirrors avoidscen.mjs

  ENT.forEach((s, k) => {
    const z = Z(k);
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 5} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    const tamed = TAMED.includes(s);
    const wolfNbt = `PersistenceRequired:1b,Tags:["lw${k}","llama"],Attributes:[{Name:"minecraft:generic.max_health",Base:${WOLF_HP}d}],Health:${WOLF_HP}f` +
      (tamed ? `,Owner:[I;${OWNER_UUID}]` : '');
    spawn.push(`data modify storage ll:log L${k} set value []`, `data modify storage ll:log W${k} set value []`,
      `data modify storage ll:log H${k} set value []`, `data modify storage ll:log S${k} set value []`,
      `summon minecraft:llama 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["ll${k}","llama"],Strength:${s.strength}}`,
      `summon minecraft:wolf ${s.dx}.5 ${FLOOR} ${z + 0.5} {${wolfNbt}}`);
    tick.push(`${onT}run data modify storage ll:log L${k} append from entity @e[tag=ll${k},limit=1] Pos`,
      `${onT}run data modify storage ll:log W${k} append from entity @e[tag=lw${k},limit=1] Pos`,
      `${onT}run data modify storage ll:log H${k} append from entity @e[tag=lw${k},limit=1] Health`,
      `${onT}as @e[type=minecraft:llama_spit,tag=!llseen,x=${-R - 4},y=${FLOOR - 4},z=${z - R - 4},dx=${2 * R + 8},dy=24,dz=${2 * R + 8}] run function mclitellama:spit_${k}`);
    const rec = ['execute store result storage ll:log t int 1 run time query gametime',
      `data modify storage ll:log S${k} append from storage ll:log t`, 'tag @s add llseen'];
    writeFileSync(join(fdir, `spit_${k}.mcfunction`), rec.join('\n') + '\n');
  });

  // RETALIATE pen: one llama, no wolf, a growbot player 2 blocks +z of it.
  {
    const z = retZ, k = 'ret';
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 5} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    spawn.push(`data modify storage ll:log S${k} set value []`,
      `summon minecraft:llama 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["ll${k}","llama"]}`);
    tick.push(`${onT}as @e[type=minecraft:llama_spit,tag=!llseen,x=${-R - 4},y=${FLOOR - 4},z=${z - R - 4},dx=${2 * R + 8},dy=24,dz=${2 * R + 8}] run function mclitellama:spit_${k}`);
    const rec = ['execute store result storage ll:log t int 1 run time query gametime',
      `data modify storage ll:log S${k} append from storage ll:log t`, 'tag @s add llseen'];
    writeFileSync(join(fdir, `spit_${k}.mcfunction`), rec.join('\n') + '\n');
  }

  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), (tick.concat(['execute if score #on ll matches 1 if score #t ll matches ..' + (T - 1) + ' run scoreboard players add #t ll 1'])).join('\n') + '\n');

  const server = await startServer({ workDir, port: 25892, rconPort: 26892, xmx: '1280M' });
  const t0 = Date.now();
  const entCases = {}, retCases = { shots: [] }, notes = [];
  for (const s of ENT) entCases[s.id] = { strength: s.strength, dx: s.dx, tamed: TAMED.includes(s), llamaLogs: [], wolfLogs: [], healthLogs: [], shots: [] };
  let rcon, bot, loop;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'gamerule doMobLoot false',
      'gamerule mobGriefing false', 'scoreboard objectives add ll dummy', 'scoreboard players set #on ll 0',
      'datapack enable "file/mclitellama"']) await C(c);
    const nRows = ENT.length;
    for (let k0 = 0; k0 < nRows; k0 += 10) {
      const r = await C(`forceload add ${-R - 32} ${Z(k0) - R - 32} ${R + 32} ${Z(Math.min(k0 + 10, nRows)) + R + 32}`);
      if (/too many|Unable/i.test(r)) throw new Error('forceload: ' + r);
    }
    { const r = await C(`forceload add ${-R - 32} ${retZ - R - 32} ${R + 32} ${retZ + R + 32}`); if (/too many|Unable/i.test(r)) throw new Error('forceload(ret): ' + r); }
    const a = await C('function mclitellama:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    await sleep(500);

    bot = await connectFakePlayer({ port: server.port, name: 'llb0', confirmTeleports: true, captureVelocity: true });
    await C('gamemode survival llb0');
    await C(`tp llb0 0.5 ${FLOOR} ${retZ - 2 + 0.5} 0 0`);
    let mode = 'stand';
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(0.5, FLOOR, retZ - 2 + 0.5, true); }, 50);
    await sleep(500);

    const list = (r) => { const m = /(?:data|contents): \[(.*)\]\s*$/.exec(r.trim()); return m && m[1].trim() ? m[1].split(',').map((v) => v.trim().replace(/^"|"$/g, '')) : []; };
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };

    for (let rep = 0; rep < REPS; rep++) {
      await C('kill @e[type=!player]');
      await C('scoreboard players set #t ll 0');
      await C('tag @e remove llseen');
      const n0 = bot.spawnedIds.length;
      await C(`tp llb0 0.5 ${FLOOR} ${retZ - 2 + 0.5} 0 0`);
      await C('effect clear llb0');
      await C('effect give llb0 minecraft:instant_health 1 5');
      await C('effect give llb0 minecraft:resistance 1000 3 true');
      await C('effect give llb0 minecraft:fire_resistance 1000 0 true');
      await C('function mclitellama:spawn');
      await sleep(300);
      await C('scoreboard players set #on ll 1');
      // one real Attack packet at the llama the RETALIATE pen just spawned.
      const ids = bot.spawnedIds.slice(n0);
      if (!ids.length) notes.push(`rep ${rep}: no spawn id seen for the retaliate llama`);
      else bot.attack(ids[ids.length - 1]);
      const g0 = await gametime();
      for (;;) {
        const t = (await gametime()) - g0;
        const hr = /(-?[\d.]+)f?\s*$/.exec((await C('data get entity llb0 Health')).trim());
        if (hr && parseFloat(hr[1]) < 12) await C('effect give llb0 minecraft:instant_health 1 5');
        if (t >= T) break;
        await sleep(Math.min(1000, (T - t) * 50));
      }
      await C('scoreboard players set #on ll 0');
      for (const s of ENT) {
        const k = ENT.indexOf(s);
        const L = parsePosList(await C(`data get storage ll:log L${k}`));
        const W = parsePosList(await C(`data get storage ll:log W${k}`));
        const Hraw = list(await C(`data get storage ll:log H${k}`)).map((v) => parseFloat(v));
        const Sraw = list(await C(`data get storage ll:log S${k}`)).map((v) => parseInt(v, 10) - g0);
        entCases[s.id].llamaLogs.push(L);
        entCases[s.id].wolfLogs.push(W);
        entCases[s.id].healthLogs.push(Hraw);
        entCases[s.id].shots.push(spitSummary(Sraw));
        if (L.length !== T || W.length !== T) notes.push(`rep ${rep} ${s.id}: ${L.length}/${W.length}/${T} samples`);
      }
      {
        const Sraw = list(await C('data get storage ll:log Sret')).map((v) => parseInt(v, 10) - g0);
        retCases.shots.push(spitSummary(Sraw));
        if (DEBUG) console.error(`[dbg] retaliate rep ${rep}: ${Sraw.join(',')}`);
      }
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of ENT) {
    const c = entCases[s.id];
    console.log(`  ${s.id.padEnd(16)} ${c.shots.map((sh, i) => `spit ${sh.n}/first ${sh.first}/cyc ${sh.medCycle} finalHP ${c.healthLogs[i][c.healthLogs[i].length - 1]}`).join(' | ')}`);
  }
  console.log(`  retaliate       ${retCases.shots.map((sh) => `spit ${sh.n}/first ${sh.first}`).join(' | ')}`);
  const golden = { pack: 'mob-llama', version: '1.18.2', T, REPS, R, WOLF_HP,
    clock: 'summon (AI on, persistent, NBT form), 300ms settle, then #on=1 starts an exact T-tick datapack window: logs Pos/Health each tick and tags each new llama_spit the gametime it first exists; entry i = i ticks after logging started (not the summon tick)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), entCases, retCases, notes };
  const dir = join(refereeWorkDir(), 'golden'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mob-llama.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runllama: ${ENT.length} ent + 1 retaliate case in ${golden.seconds} s -> ${join(dir, 'mob-llama.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
