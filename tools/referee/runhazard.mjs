#!/usr/bin/env node
// runhazard.mjs — the referee's BLOCK HAZARD runner (infra I6, s142). Scenarios: hazardscen.mjs.
//   node tools/referee/runhazard.mjs      # 20 scenarios x REPS, ~40 s
// Per rep: kill, arena, summon every NoAI mob, then ONE function that places every hazard block and resets the per-lane Health
// logs in the same server tick; a datapack tick function appends each lane's Health every tick (entry i = after i ticks);
// ONE bounded wait on the server WE started (not polling, D-436); read every log. Own port 25647 + work dir
// (MCLITE_HAZARD_WORKDIR, default ~/.mclite-referee-hazard); golden -> <referee dir>/golden/hazards.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, REPS, PITCH, T } from './hazardscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
async function main() {
  const workDir = process.env.MCLITE_HAZARD_WORKDIR || join(homedir(), '.mclite-referee-hazard');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclhz');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclhz', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee hazards' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclhz:tick'] }));
  const X = (k) => k * PITCH;
  const arena = [], spawn = [], give = [], tick = [];
  SCEN.forEach((s, k) => {
    const x = X(k);
    arena.push(`fill ${x - 1} ${PAD} -1 ${x + 1} ${PAD + 3} 1 minecraft:glass`, `fill ${x} ${PAD + 1} 0 ${x} ${PAD + 3} 0 minecraft:air`,
      `setblock ${x} ${PAD} 0 minecraft:${s.floor}`);
    spawn.push(`summon minecraft:${s.mob} ${x + 0.5} ${PAD + 1} 0.5 {PersistenceRequired:1b,Silent:1b,Tags:["ef${k}"]}`);
    if (s.at) give.push(`setblock ${x} ${PAD + 1} 0 minecraft:${s.at}`);
    if (s.head) give.push(`setblock ${x} ${PAD + 2} 0 minecraft:${s.head}`);
    tick.push(`execute if score #on mclhz matches 1 run data modify storage mclhz:r l${k} append from entity @e[tag=ef${k},limit=1] Health`);
  });
  give.push('data remove storage mclhz:r l0');
  SCEN.forEach((s, k) => give.push(`data modify storage mclhz:r l${k} set value []`));
  give.push('scoreboard players set #on mclhz 1');
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'give.mcfunction'), give.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25647, rconPort: 26647, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, series: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'scoreboard objectives add mclhz dummy', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    await sleep(1500);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #on mclhz 0');
      await C('kill @e[type=!player]');
      await sleep(150);
      const a = await C('function mclhz:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded');
      await C('kill @e[type=item]');
      await C('function mclhz:spawn');
      await sleep(300);
      await C('function mclhz:give');
      await sleep(T * 50 + 1500);
      await C('scoreboard players set #on mclhz 0');
      for (let k = 0; k < SCEN.length; k++) {
        const r = await C(`data get storage mclhz:r l${k}`);
        const m = /\[(.*)\]/s.exec(r);
        const arr = m && m[1].trim() ? m[1].split(',').map((q) => parseFloat(q)) : [];
        cases[SCEN[k].id].series.push(arr.slice(0, T));
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(30)} ${c.series.map((q) => `${q.length}t ${q[0]}->${q[q.length - 1]}`).join(' | ')}`); }
  const golden = { pack: 'hazards', version: '1.18.2', REPS, T, clock: 'AI-on mob in a 1x1 pen -> hazard placed (same tick as the log reset) -> Health every tick, entry 0 = before any world tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hazards.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runhazard: ${golden.seconds} s -> ${join(dir, 'hazards.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
