#!/usr/bin/env node
// runxp2.mjs — the referee's BREEDING + FURNACE XP runner (infra I6 xp2, 25 Sept 2026).
//
//   node tools/referee/runxp2.mjs                       # both scenarios
//   node tools/referee/runxp2.mjs --only breed           # just (A)
//   node tools/referee/runxp2.mjs --only furnace         # just (B)
//
// Neither scenario needs a player nearby (unlike mob-kill xp, D-xprefcheck): breeding orbs
// (AnimalEntity.java:236) and furnace orbs (AbstractFurnaceBlockEntity.java:483-489) spawn
// behind `doMobLoot` alone. So there is no growbot/xpbot here -- just a walled 10x10 arena of
// 5-block cells (same shape as runxp.mjs's) so orbs from one cell never drift into a neighbour's
// sum, one `Value * Count` datapack function reused for both scenarios, and bounded sleeps on a
// server WE started (D-436).
//
// Own port (25631/26631, MCLITE_XP2_WORKDIR) so this runs beside runxp.mjs's 25611/26611 and the
// other referee runner's 25621. Golden: <referee dir>/golden/xp2.json (D-6: generated, never
// committed) -- { breed: { N, variants: { species: { values: [...] } } }, furnace: { N, variants:
// { comboId: { recipe, xp, n, values: [...] } } }, notes }.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { BREED_SPECIES, BREED_N, FURNACE_VARIANTS, FURNACE_N } from './xp2scen.mjs';

const Y = -60;                 // flat world surface (server.mjs: bedrock + 2 dirt + grass from y=-64)
const CELL = 5, SIDE = 10;     // 100 cells, 5-block pitch -- same shape as runxp.mjs's arena
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '') || 'breed,furnace';

async function main() {
  const workDir = process.env.MCLITE_XP2_WORKDIR || join(homedir(), '.mclite-referee-xp2');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitexp2');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitexp2', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee xp2 (breed+furnace)' } }));
  const cells = Array.from({ length: SIDE * SIDE }, (_, i) => ({ x: (i % SIDE) * CELL, z: Math.floor(i / SIDE) * CELL }));
  writeFileSync(join(fdir, 'arena.mcfunction'), [`fill 0 ${Y} 0 ${CELL * SIDE} ${Y + 4} ${CELL * SIDE} minecraft:glass`,
    ...cells.map((c) => `fill ${c.x + 1} ${Y} ${c.z + 1} ${c.x + CELL - 1} ${Y + 4} ${c.z + CELL - 1} minecraft:air`)].join('\n') + '\n');
  writeFileSync(join(fdir, 'orb.mcfunction'), [
    'execute store result score #a mclx run data get entity @s Value',
    'execute store result score #b mclx run data get entity @s Count',
    'scoreboard players operation #a mclx *= #b mclx',
    'scoreboard players operation #s mclx += #a mclx',
  ].join('\n') + '\n');
  // one shared per-cell reader: sums orbs within each cell into storage mclitexp2:r v[i]
  writeFileSync(join(fdir, 'read.mcfunction'), [`data modify storage mclitexp2:r v set value [${cells.map(() => '0').join(',')}]`,
    ...cells.flatMap((c, i) => ['scoreboard players set #s mclx 0',
      `execute as @e[type=experience_orb,x=${c.x + 1},y=${Y - 1},z=${c.z + 1},dx=${CELL - 2},dy=7,dz=${CELL - 2}] run function mclitexp2:orb`,
      `execute store result storage mclitexp2:r v[${i}] int 1 run scoreboard players get #s mclx`])].join('\n') + '\n');

  // (A) breeding: for each species, 2 adult in-love parents per cell (offset 1 block so
  // MateGoal's own pathfinding closes the gap -- driving the REAL AI, not teleporting them
  // together), N=100 pairs.
  const BREED_CELLS = cells.slice(0, BREED_N);
  BREED_SPECIES.forEach((sp, k) => {
    const tag = 'InLove:600,Age:0,PersistenceRequired:1b,Silent:1b';
    writeFileSync(join(fdir, `breed${k}_spawn.mcfunction`), BREED_CELLS.flatMap((c) => [
      `summon minecraft:${sp.mob} ${c.x + 2} ${Y} ${c.z + 2.5} {${tag}}`,
      `summon minecraft:${sp.mob} ${c.x + 3} ${Y} ${c.z + 2.5} {${tag}}`,
    ]).join('\n') + '\n');
  });

  // (B) furnace: one furnace per cell, RecipesUsed set by NBT (no actual smelting -- the NBT IS
  // the ledger AbstractFurnaceBlockEntity.getRecipesUsedAndDropExperience reads, verified
  // .decomp AbstractFurnaceBlockEntity.java:220-236 read/write of that exact tag), then broken
  // with /setblock air so AbstractFurnaceBlock.onStateReplaced fires. Reused across every combo.
  const FURN_CELLS = cells.slice(0, FURNACE_N);
  writeFileSync(join(fdir, 'furn_place.mcfunction'),
    FURN_CELLS.map((c) => `setblock ${c.x + 2} ${Y} ${c.z + 2} minecraft:furnace`).join('\n') + '\n');
  FURNACE_VARIANTS.forEach((v, k) => {
    writeFileSync(join(fdir, `furn${k}_set.mcfunction`), FURN_CELLS.map((c) =>
      `data merge block ${c.x + 2} ${Y} ${c.z + 2} {RecipesUsed:{"${v.recipe}":${v.n}}}`).join('\n') + '\n');
  });
  writeFileSync(join(fdir, 'furn_break.mcfunction'),
    FURN_CELLS.map((c) => `setblock ${c.x + 2} ${Y} ${c.z + 2} minecraft:air destroy`).join('\n') + '\n');

  const server = await startServer({ workDir, port: 25631, rconPort: 26631, xmx: '1536M' });
  const t0 = Date.now();
  let rcon;
  const breed = {}, furnace = {}, notes = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'gamerule doMobLoot true', 'gamerule mobGriefing true', 'scoreboard objectives add mclx dummy',
      `forceload add 0 0 ${CELL * SIDE + 8} ${CELL * SIDE + 8}`, 'function mclitexp2:arena']) await C(c);
    const fl = await C('datapack list enabled');
    if (!/mclitexp2/.test(fl)) notes.push('datapack not enabled: ' + fl.trim().slice(0, 200));

    if (only.includes('breed')) {
      for (let k = 0; k < BREED_SPECIES.length; k++) {
        const sp = BREED_SPECIES[k];
        await C(`kill @e[type=!player]`);
        await sleep(150);
        const sr = await C(`function mclitexp2:breed${k}_spawn`);
        const cnt = await C(`execute if entity @e[type=minecraft:${sp.mob}]`);
        const nSp = +((/count: (\d+)/.exec(cnt) || [])[1] || 0);
        if (nSp !== BREED_N * 2) notes.push(`${sp.id}: ${nSp}/${BREED_N * 2} parents summoned (${sr.trim().slice(0, 120)})`);
        // MateGoal is real AI: give it real time to path to its partner and breed (bounded, D-436:
        // a sleep on a server we started, not a poll). One retry window if some cells lag.
        await sleep(4000);
        let nOrb = +((/count: (\d+)/.exec(await C(`execute if entity @e[type=experience_orb]`)) || [])[1] || 0);
        if (nOrb < BREED_N) await sleep(4000);   // one bounded retry window for the slower pairs
        await C('function mclitexp2:read');
        const r = await C('data get storage mclitexp2:r v');
        const m = /\[(.*)\]/.exec(r);
        const values = m ? m[1].split(',').map((t) => parseInt(t.trim(), 10)) : [];
        if (values.length !== BREED_N) { notes.push(`${sp.id}: unreadable sums (${r.trim().slice(0, 120)})`); continue; }
        const zero = values.filter((v) => !v).length;
        if (zero) notes.push(`${sp.id}: ${zero}/${BREED_N} wells never bred (no orb)`);
        breed[sp.id] = { mob: sp.mob, values };
        console.log(`  breed ${sp.id.padEnd(12)} mean ${(values.reduce((s, x) => s + x, 0) / values.length).toFixed(2)}  [${Math.min(...values)}..${Math.max(...values)}]  ${zero ? zero + ' no-breed' : ''}`);
      }
    }

    if (only.includes('furnace')) {
      await C('kill @e[type=experience_orb]');
      await C('function mclitexp2:furn_place');
      for (let k = 0; k < FURNACE_VARIANTS.length; k++) {
        const v = FURNACE_VARIANTS[k];
        await C(`function mclitexp2:furn${k}_set`);
        await C('function mclitexp2:furn_break');
        await sleep(300);   // orb spawn is synchronous with onStateReplaced -- just enough for RCON's reply
        await C('function mclitexp2:read');
        const r = await C('data get storage mclitexp2:r v');
        const m = /\[(.*)\]/.exec(r);
        const values = m ? m[1].split(',').map((t) => parseInt(t.trim(), 10)) : [];
        if (values.length !== FURNACE_N) { notes.push(`${v.id}: unreadable sums (${r.trim().slice(0, 120)})`); continue; }
        furnace[v.id] = { recipe: v.recipe, xp: v.xp, n: v.n, values };
        await C('kill @e[type=experience_orb]');
        await C('function mclitexp2:furn_place');
        console.log(`  furnace ${v.id.padEnd(16)} mean ${(values.reduce((s, x) => s + x, 0) / values.length).toFixed(3)}  [${Math.min(...values)}..${Math.max(...values)}]`);
      }
      await C('fill 0 ' + Y + ' 0 ' + (CELL * SIDE) + ' ' + Y + ' ' + (CELL * SIDE) + ' minecraft:air');
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = {
    pack: 'xp2', version: '1.18.2', generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    breed: { N: BREED_N, variants: breed },
    furnace: { N: FURNACE_N, variants: furnace },
    notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'xp2.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runxp2: ${Object.keys(breed).length} breed species, ${Object.keys(furnace).length} furnace combos, ${golden.seconds}s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
