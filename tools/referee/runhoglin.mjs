#!/usr/bin/env node
// runhoglin.mjs — infra W (25 Sept 2026): golden for hoglinrefcheck.mjs — HOGLIN REPELLENT AVOIDANCE on the real
// 1.18.2 server. Scenarios: hoglinscen.mjs. One stone pen per scenario, forceloaded, no player anywhere near it (a
// visible player would give the hoglin a FIGHT/target-seek that competes with the IDLE-only repellent flee); the
// hoglin (or baby) summoned at the pen centre (AI on, persistent, NBT form), the repellent block (if any) `/setblock`
// at its dx/dy offset. A datapack TICK function appends the mob's Pos every tick (tick-exact: it runs before the
// world ticks, so entry i = the position after i world ticks, entry 0 = the summon position). Own port 25801/25802
// (MCLITE_REFEREE_DIR picks the work dir AND the golden dir -- see docs/archive/REFEREE.md).
//   MCLITE_REFEREE_DIR=/home/claude/w/refw node tools/referee/runhoglin.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN as LIVE, T, R, PITCH, REPS } from './hoglinscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;                 // the flat world's grass top is y -61: the pen's stone floor replaces it

async function main() {
  const workDir = process.env.MCLITE_HOGLIN_WORKDIR || join(homedir(), '.mclite-referee-hoglin');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitehoglin');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitehoglin', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee hoglin' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitehoglin:tick'] }));
  const Z = (k) => k * PITCH;
  const arena = [], spawn = [], log = [];
  LIVE.forEach((s, k) => {
    const z = Z(k);
    arena.push(`fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR + 5} ${z + R + 1} minecraft:air`,
      `fill ${-R - 1} ${FLOOR - 1} ${z - R - 1} ${R + 1} ${FLOOR - 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R - 1} ${FLOOR} ${z - R - 1} ${R + 1} ${FLOOR + 1} ${z + R + 1} minecraft:stone`,
      `fill ${-R} ${FLOOR} ${z - R} ${R} ${FLOOR + 1} ${z + R} minecraft:air`);
    if (s.repellent) arena.push(`setblock ${s.dx} ${FLOOR + s.dy} ${z} ${s.repellent} replace`);
    spawn.push(`data modify storage mclite:hoglin l${k} set value []`,
      `summon minecraft:${s.mob} 0.5 ${FLOOR} ${z + 0.5} {PersistenceRequired:1b,Tags:["hg${k}","hoglin"]${s.nbt ? ',' + s.nbt : ''}}`);
    log.push(`data modify storage mclite:hoglin l${k} append from entity @e[tag=hg${k},limit=1] Pos`);
  });
  spawn.push('scoreboard players set #t mc 0', 'scoreboard players set #run mc 1');
  const tick = ['execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitehoglin:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'];
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), log.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25801, rconPort: 25802, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of LIVE) cases[s.id] = { mob: s.mob, nbt: s.nbt || '', repellent: s.repellent, dx: s.dx, dy: s.dy, logs: [] };
  let rcon, memoryNote = null;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0',
      `forceload add -32 -32 32 ${Z(LIVE.length) + 32}`]) await C(c);
    const a = await C('function mclitehoglin:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    await sleep(1000);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      await sleep(300);
      await C('function mclitehoglin:spawn');
      await sleep(T * 50 + 1000);
      let tNow = 0;
      for (let i = 0; i < 40; i++) {                     // bounded: our own server catching up (D-436 allows this)
        tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
        if (tNow >= T) break; await sleep(500);
      }
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow}/${T} ticks ran`);
      // best-effort BRAIN MEMORY sample (task: "sample Brain memories if /data get entity exposes them"), taken
      // once on rep 0 for the dist3 case, mid-flee -- NOT asserted on by the check, just carried in the golden.
      if (rep === 0 && memoryNote === null) {
        const k0 = LIVE.findIndex((q) => q.id === 'dist3');
        if (k0 >= 0) {
          const r = await C(`data get entity @e[tag=hg${k0},limit=1] Brain.memories`);
          memoryNote = /minecraft:nearest_repellent/i.test(r) ? 'nearest_repellent memory present' : (r.slice(0, 200));
        }
      }
      for (let k = 0; k < LIVE.length; k++) {
        const L = parsePosList(await C(`data get storage mclite:hoglin l${k}`));
        const z0 = Z(k);
        cases[LIVE[k].id].logs.push(L.map(([x, y, z]) => [Math.round(x * 1e4) / 1e4, Math.round((y - FLOOR) * 1e4) / 1e4, Math.round((z - z0) * 1e4) / 1e4]));
        if (L.length !== T) notes.push(`rep ${rep} ${LIVE[k].id}: ${L.length}/${T} samples (mob gone?)`);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'hoglin-repel', version: '1.18.2', T, REPS, R,
    clock: 'summon (AI on, persistent, NBT form) -> tick function logs Pos before each world tick; entry i = after i world ticks; positions local (x/z relative to the pen centre, y above the floor)',
    memoryNote, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hoglin-repel.json'), JSON.stringify(golden) + '\n');
  for (const s of LIVE) { const L = cases[s.id].logs[0] || []; console.log(`  ${s.id.padEnd(16)} @0 ${(L[0] || []).slice(0, 3).join(',')}  @${T - 1} ${(L[T - 1] || []).slice(0, 3).join(',')}`); }
  console.log(`referee/runhoglin: ${golden.seconds} s -> ${join(dir, 'hoglin-repel.json')}`);
  if (memoryNote) console.log(`  brain memory sample (dist3, rep 0): ${memoryNote}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
