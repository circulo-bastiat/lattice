#!/usr/bin/env node
// runbarter.mjs — infra I6 (s138): golden for barterrefcheck.mjs (scenarios + why: barterscen.mjs). Own port 25695.
// (a) table rolls: runloot.mjs's own chest-and-storage batching (copied: 25 rolls per function call, one RCON read per
// batch, a cut reply drops the batch). (b) live: pen, piglin at the centre facing east, gold stack `dist` east; a
// datapack TICK logger appends [gold count on the ground, other item entities] every tick for T ticks.
//   node tools/referee/runbarter.mjs          (~2 min table + ~REPS x scenes x 36 s)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { parseRollLog } from './runloot.mjs';
import { SCEN, T, REPS, R, ROLLS } from './barterscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60, BATCH = 25, CHEST = '30 -60 30';
const parseInts = (reply) => { const m = /\[(.*)\]\s*$/.exec(reply.trim()); return m ? m[1].split(',').map((q) => parseInt(q, 10)).filter((v) => !Number.isNaN(v)) : []; };
const GOLD = '@e[type=item,limit=1,nbt={Item:{id:"minecraft:gold_ingot"}}]';

async function main() {
  const workDir = process.env.MCLITE_BARTER_WORKDIR || join(homedir(), '.mclite-referee-barter');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitebarter');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitebarter', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee barter' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitebarter:tick'] }));
  const roll = [];
  for (let k = 0; k < BATCH; k++) roll.push(`loot replace block ${CHEST} container.0 27 loot minecraft:gameplay/piglin_bartering`,
    'data modify storage mcliteref:o l append value {R:1b}', `data modify storage mcliteref:o l append from block ${CHEST} Items[]`);
  writeFileSync(join(fdir, 'roll.mcfunction'), roll.join('\n') + '\n');
  writeFileSync(join(fdir, 'arena.mcfunction'), [
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR + 3} ${R + 1} minecraft:air`,
    `fill ${-R - 1} ${FLOOR - 1} ${-R - 1} ${R + 1} ${FLOOR - 1} ${R + 1} minecraft:stone`,
    `fill ${-R - 1} ${FLOOR} ${-R - 1} ${R + 1} ${FLOOR + 2} ${R + 1} minecraft:stone`,
    `fill ${-R} ${FLOOR} ${-R} ${R} ${FLOOR + 2} ${R} minecraft:air`].join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), [
    'scoreboard players set #g mc 0',
    `execute store result score #g mc run data get entity ${GOLD} Item.Count`,
    'execute store result score #o mc if entity @e[type=item,nbt=!{Item:{id:"minecraft:gold_ingot"}}]',
    'execute store result storage mclite:b v int 1 run scoreboard players get #g mc',
    'data modify storage mclite:b g append from storage mclite:b v',
    'execute store result storage mclite:b v int 1 run scoreboard players get #o mc',
    'data modify storage mclite:b o append from storage mclite:b v'].join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), ['execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitebarter:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25695, rconPort: 26695, xmx: '1536M' });
  const t0 = Date.now();
  const table = { rolls: 0, empty: 0, items: {} }, cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { count: s.count, dist: s.dist, gold: [], other: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'scoreboard objectives add mc dummy',
      'scoreboard players set #run mc 0', `forceload add ${-R - 16} ${-R - 16} ${R + 40} ${R + 40}`, `setblock ${CHEST} minecraft:chest`]) await C(c);
    // (a) the table
    for (let b = 0; b * BATCH < ROLLS; b++) {
      await C('data modify storage mcliteref:o l set value []');
      const r = await C('function mclitebarter:roll');
      if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push('roll: ' + r.trim().slice(0, 140)); break; }
      const rolls = parseRollLog(await C('data get storage mcliteref:o l'));
      if (rolls.length !== BATCH) { notes.push(`batch ${b}: ${rolls.length}/${BATCH} (reply cut) -- dropped`); continue; }
      for (const items of rolls) {
        table.rolls++; if (!items.length) table.empty++;
        const per = {}; for (const it of items) per[it.id] = (per[it.id] || 0) + it.count;
        for (const [id, n] of Object.entries(per)) {
          const q = table.items[id] || (table.items[id] = { total: 0, sq: 0, hits: 0, min: Infinity, max: 0 });
          q.total += n; q.sq += n * n; q.hits++; q.min = Math.min(q.min, n); q.max = Math.max(q.max, n);
        }
      }
    }
    console.log(`  table: ${table.rolls} rolls, ${Object.keys(table.items).length} items`);
    // (b) live
    const a = await C('function mclitebarter:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    for (const s of SCEN) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('scoreboard players set #run mc 0');
        await C('kill @e[type=!player]');
        await sleep(200);
        await C('kill @e[type=item]');                        // a killed piglin DROPS what it held (the ingot it admired)
        await C('data modify storage mclite:b g set value []');
        await C('data modify storage mclite:b o set value []');
        await sleep(200);
        await C(`summon minecraft:piglin 0.5 ${FLOOR} 0.5 {PersistenceRequired:1b,IsImmuneToZombification:1b,Rotation:[-90f,0f]}`);
        await sleep(500);                                   // land
        await C('scoreboard players set #t mc 0');
        await C(`summon minecraft:item ${0.5 + s.dist} ${FLOOR} 0.5 {Item:{id:"minecraft:gold_ingot",Count:${s.count}b},PickupDelay:0s,Motion:[0.0,0.0,0.0]}`);
        await C('scoreboard players set #run mc 1');
        await sleep(T * 50 + 600);
        for (let i = 0; i < 40; i++) {                      // bounded: our own server catching up (D-436 allows this)
          const tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
          if (tNow >= T) break; await sleep(500);
        }
        await C('scoreboard players set #run mc 0');
        const G = parseInts(await C('data get storage mclite:b g')), O = parseInts(await C('data get storage mclite:b o'));
        if (G.length < T) notes.push(`${s.id} rep ${rep}: ${G.length}/${T} samples`);
        cases[s.id].gold.push(G); cases[s.id].other.push(O);
      }
      console.log(`  ${s.id.padEnd(8)} gold@end ${cases[s.id].gold.map((g) => g[g.length - 1]).join('/')}  drops@end ${cases[s.id].other.map((o) => o[o.length - 1]).join('/')}`);
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const q of Object.values(table.items)) if (q.min === Infinity) q.min = 0;
  const golden = { pack: 'barter', version: '1.18.2', ROLLS, T, REPS,
    clock: 'live: gold item summoned the tick the logger is armed (entry 0); g = Count of the gold item entity on the ground (0 = none), o = number of non-gold item entities',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), table, cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'barter.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runbarter: ${golden.seconds} s -> ${join(dir, 'barter.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
