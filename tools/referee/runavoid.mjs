#!/usr/bin/env node
// runavoid.mjs — infra W (25 Sept 2026): golden for avoidrefcheck.mjs — MOB AVOID/FLEE on the real 1.18.2 server.
// Scenarios: avoidscen.mjs (ENT: fleer+threat mob pairs; SHADE: a burning mob near a roofed shade pen at
// noon/midnight). One pen per scenario (stone floor + 2-high walls, mirrors panicscen.mjs/hoglinscen.mjs); both
// mobs of an ENT pen and the one mob of a SHADE pen are summoned AI-on/persistent/NBT-form, no player anywhere
// (a visible player would give a hostile a target-seek that competes with these IDLE-tier flee goals). A
// datapack TICK function appends every relevant mob's Pos every tick (tick-exact: it runs before the world
// ticks, so entry i = the position after i world ticks, entry 0 = the summon tick). Two SUB-RUNS per rep,
// switched by a `#phase` scoreboard score, because ENT doesn't care about time of day but SHADE needs noon for
// the "should flee" case and midnight for its control, and time is a WORLD-global clock:
//   phase 1 (time 18000, midnight): every ENT scenario + skeleton_shade_night (the day-gate control).
//   phase 2 (time 6000, noon): skeleton_shade_noon + zombie_shade_noon.
// Own dir/port: MCLITE_REFEREE_DIR picks the work dir AND the golden dir; MCLITE_REFEREE_PORT picks the server
// port (server.mjs honours both, see docs/archive/REFEREE.md) — this file never hardcodes a port, it always reads
// `server.port`/`server.rconPort` off startServer()'s own result.
//   MCLITE_REFEREE_DIR=... MCLITE_REFEREE_PORT=... node tools/referee/runavoid.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { ENT, SHADE, T, R, PITCH, REPS, SHADE_R, SHADE_X0, SHADE_SPAWN_X, SHADE_FIRE } from './avoidscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: each pen's stone floor replaces it

async function main() {
  const workDir = process.env.MCLITE_AVOID_WORKDIR || join(homedir(), '.mclite-referee-avoid');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteavoid');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteavoid', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee avoid' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteavoid:tick'] }));

  const Z = (k) => k * PITCH;
  const nEnt = ENT.length;
  const shadeZ = (j) => Z(nEnt + j);

  const arena = [], spawnEnt = [], spawnShadeNight = [], spawnShadeNoon = [], logEnt = [], logShade = [];

  ENT.forEach((s, k) => {
    const z = Z(k);
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 5} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    spawnEnt.push(`data modify storage mclite:avoid f${k} set value []`,
      `summon minecraft:${s.mob} 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["avf${k}","avoid"]${s.nbt ? ',' + s.nbt : ''}}`,
      `effect give @e[tag=avf${k}] minecraft:resistance 1000000 255 true`);
    logEnt.push(`data modify storage mclite:avoid f${k} append from entity @e[tag=avf${k},limit=1] Pos`);
    if (s.threat) {
      spawnEnt.push(`data modify storage mclite:avoid t${k} set value []`,
        `summon minecraft:${s.threat} ${s.dx}.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["avt${k}","avoid"]}`,
        `effect give @e[tag=avt${k}] minecraft:resistance 1000000 255 true`);
      logEnt.push(`data modify storage mclite:avoid t${k} append from entity @e[tag=avt${k},limit=1] Pos`);
    }
  });

  SHADE.forEach((s, j) => {
    const z = shadeZ(j);
    arena.push(`fill ${-SHADE_R - 1} ${FLOOR - 1} ${z - SHADE_R - 1} ${SHADE_R + 1} ${FLOOR + 5} ${z + SHADE_R + 1} minecraft:air`,
      `fill ${-SHADE_R - 1} ${FLOOR - 1} ${z - SHADE_R - 1} ${SHADE_R + 1} ${FLOOR - 1} ${z + SHADE_R + 1} minecraft:stone`,
      `fill ${-SHADE_R - 1} ${FLOOR} ${z - SHADE_R - 1} ${SHADE_R + 1} ${FLOOR + 1} ${z + SHADE_R + 1} minecraft:stone`,
      `fill ${-SHADE_R} ${FLOOR} ${z - SHADE_R} ${SHADE_R} ${FLOOR + 1} ${z + SHADE_R} minecraft:air`,
      // the roof: closes the sky over the RIGHT half only (x in [SHADE_X0, SHADE_R]), same z span as the pen.
      `fill ${SHADE_X0} ${FLOOR + 2} ${z - SHADE_R} ${SHADE_R} ${FLOOR + 2} ${z + SHADE_R} minecraft:stone`);
    const spawnList = (s.time === 6000) ? spawnShadeNoon : spawnShadeNight;
    spawnList.push(`data modify storage mclite:avoid s${j} set value []`,
      `summon minecraft:${s.mob} ${SHADE_SPAWN_X}.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Fire:${SHADE_FIRE}s,Tags:["avs${j}","avoid"]${s.nbt ? ',' + s.nbt : ''}}`,
      `effect give @e[tag=avs${j}] minecraft:resistance 1000000 255 true`);
    logShade.push(`data modify storage mclite:avoid s${j} append from entity @e[tag=avs${j},limit=1] Pos`);
  });

  const spawnPhase1 = [...spawnEnt, ...spawnShadeNight];
  const spawnPhase2 = [...spawnShadeNoon];
  const logPhase1 = [...logEnt, ...logShade.filter((_, j) => SHADE[j] && SHADE[j].time !== 6000)];
  const logPhase2 = logShade.filter((_, j) => SHADE[j] && SHADE[j].time === 6000);

  spawnPhase1.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1', 'scoreboard players set #phase mc 1');
  spawnPhase2.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1', 'scoreboard players set #phase mc 2');
  const tick = [
    `execute if score #run mc matches 1 if score #t mc matches ..${T - 1} if score #phase mc matches 1 run function mcliteavoid:log1`,
    `execute if score #run mc matches 1 if score #t mc matches ..${T - 1} if score #phase mc matches 2 run function mcliteavoid:log2`,
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1',
  ];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn1.mcfunction'), spawnPhase1.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn2.mcfunction'), spawnPhase2.join('\n') + '\n');
  writeFileSync(join(fdir, 'log1.mcfunction'), (logPhase1.join('\n') || '# none') + '\n');
  writeFileSync(join(fdir, 'log2.mcfunction'), (logPhase2.join('\n') || '# none') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');

  // never hardcode a port: startServer() reads MCLITE_REFEREE_PORT/MCLITE_REFEREE_DIR itself (server.mjs), and
  // every RCON/growbot connection below uses the PORTS THIS CALL RETURNS, not a literal.
  const server = await startServer({ workDir, xmx: '1536M' });
  const t0 = Date.now();
  const entCases = {}, shadeCases = {}, notes = [];
  for (const s of ENT) entCases[s.id] = { mob: s.mob, threat: s.threat, dx: s.dx, fleerLogs: [], threatLogs: [] };
  for (const s of SHADE) shadeCases[s.id] = { mob: s.mob, time: s.time, logs: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0']) await C(c);
    // forceload refuses more than 256 chunks per command (chasescen's own note): slice the z range into batches
    // of 10 pen-rows (10*44 blocks = 27.5 chunks; 5 chunks wide x 28 = 140 < 256) rather than one call for the
    // whole world -- a rejected forceload silently left every pen past the default simulation-distance-4 ring
    // un-ticked on the first run here (index 5 onward read back 0 samples: proved live, not guessed).
    const nRows = nEnt + SHADE.length;
    for (let k0 = 0; k0 < nRows; k0 += 10) {
      const r = await C(`forceload add -32 ${Z(k0) - 32} 32 ${Z(Math.min(k0 + 10, nRows)) + 32}`);
      // "No chunks were marked for force loading" is a SUCCESS message on a re-run against a world directory
      // that already has these chunks force-loaded from a prior run (this file only wipes the datapack, not the
      // world, between runs) -- only "too many chunks"/"Unable" are real failures.
      if (/too many|Unable/i.test(r)) throw new Error('forceload: ' + r);
    }
    const a = await C('function mcliteavoid:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    await sleep(1000);

    async function runPhase(spawnFn, time, logKind) {
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      await sleep(300);
      await C(`time set ${time}`);
      await C(`function mcliteavoid:${spawnFn}`);
      await sleep(T * 50 + 1000);
      let tNow = 0;
      for (let i = 0; i < 40; i++) {                     // bounded: our own server catching up (D-436 allows this)
        tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`${logKind}: only ${tNow}/${T} ticks ran`);
      return tNow;
    }

    for (let rep = 0; rep < REPS; rep++) {
      await runPhase('spawn1', 18000, `rep ${rep} phase1(night)`);
      for (const s of ENT) {
        const z0 = Z(ENT.indexOf(s));
        const F = parsePosList(await C(`data get storage mclite:avoid f${ENT.indexOf(s)}`));
        entCases[s.id].fleerLogs.push(F.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (F.length !== T) notes.push(`rep ${rep} ${s.id} fleer: ${F.length}/${T} samples`);
        if (s.threat) {
          const Tt = parsePosList(await C(`data get storage mclite:avoid t${ENT.indexOf(s)}`));
          entCases[s.id].threatLogs.push(Tt.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
          if (Tt.length !== T) notes.push(`rep ${rep} ${s.id} threat: ${Tt.length}/${T} samples`);
        }
      }
      for (const s of SHADE) if (s.time !== 6000) {
        const j = SHADE.indexOf(s), z0 = shadeZ(j);
        const L = parsePosList(await C(`data get storage mclite:avoid s${j}`));
        shadeCases[s.id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (L.length !== T) notes.push(`rep ${rep} ${s.id}: ${L.length}/${T} samples`);
      }

      await runPhase('spawn2', 6000, `rep ${rep} phase2(noon)`);
      for (const s of SHADE) if (s.time === 6000) {
        const j = SHADE.indexOf(s), z0 = shadeZ(j);
        const L = parsePosList(await C(`data get storage mclite:avoid s${j}`));
        shadeCases[s.id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (L.length !== T) notes.push(`rep ${rep} ${s.id}: ${L.length}/${T} samples`);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'avoid', version: '1.18.2', T, REPS, R, SHADE_R, SHADE_X0, SHADE_SPAWN_X,
    clock: 'summon (AI on, persistent, NBT form) -> tick function logs Pos before each world tick; entry i = after i world ticks; positions local (x/z relative to the pen centre, y above the floor)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), entCases, shadeCases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'avoid.json'), JSON.stringify(golden) + '\n');
  for (const s of ENT) { const L = entCases[s.id].fleerLogs[0] || []; console.log(`  ${s.id.padEnd(20)} fleer@0 ${(L[0] || []).slice(0, 3).join(',')}  @${T - 1} ${(L[T - 1] || []).slice(0, 3).join(',')}`); }
  for (const s of SHADE) { const L = shadeCases[s.id].logs[0] || []; console.log(`  ${s.id.padEnd(20)} @0 ${(L[0] || []).slice(0, 3).join(',')}  @${T - 1} ${(L[T - 1] || []).slice(0, 3).join(',')}`); }
  console.log(`referee/runavoid (server ${server.port}/${server.rconPort}): ${golden.seconds} s -> ${join(dir, 'avoid.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
