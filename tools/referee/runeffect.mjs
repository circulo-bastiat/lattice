#!/usr/bin/env node
// runeffect.mjs — the referee's STATUS EFFECT runner (infra I6, s142). Scenarios: effectscen.mjs.
//   node tools/referee/runeffect.mjs      # 20 scenarios x REPS, ~40 s
// Per rep: kill, arena, summon every NoAI mob, then ONE function that gives every /effect and resets the per-lane Health
// logs in the same server tick; a datapack tick function appends each lane's Health every tick (entry i = after i ticks);
// ONE bounded wait on the server WE started (not polling, D-436); read every log. Own port 25644 + work dir
// (MCLITE_EFFECT_WORKDIR, default ~/.mclite-referee-effect); golden -> <referee dir>/golden/effects.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, REPS, PITCH, T } from './effectscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
async function main() {
  const workDir = process.env.MCLITE_EFFECT_WORKDIR || join(homedir(), '.mclite-referee-effect');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcleff');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcleff', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee effects' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcleff:tick'] }));
  const X = (k) => k * PITCH;
  const arena = [], spawn = [], give = [], tick = [];
  SCEN.forEach((s, k) => {
    const x = X(k);
    arena.push(`fill ${x - 2} ${PAD} -2 ${x + 2} ${PAD + 4} 2 minecraft:air`, `fill ${x - 2} ${PAD} -2 ${x + 2} ${PAD} 2 minecraft:stone`);
    spawn.push(`summon minecraft:${s.mob} ${x + 0.5} ${PAD + 1} 0.5 {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["ef${k}"],Health:${s.hp}f${s.nbt ? ',' + s.nbt : ''}}`);
    give.push(`effect give @e[tag=ef${k},limit=1] minecraft:${s.eff} ${s.secs} ${s.amp} true`);
    tick.push(`execute if score #on mcleff matches 1 run data modify storage mcleff:r l${k} append from entity @e[tag=ef${k},limit=1] Health`);
  });
  give.push('data remove storage mcleff:r l0');
  SCEN.forEach((s, k) => give.push(`data modify storage mcleff:r l${k} set value []`));
  give.push('scoreboard players set #on mcleff 1');
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'give.mcfunction'), give.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25644, rconPort: 26644, xmx: '1024M' });
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
      'weather clear', 'scoreboard objectives add mcleff dummy', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    await sleep(1500);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #on mcleff 0');
      await C('kill @e[type=!player]');
      await sleep(150);
      const a = await C('function mcleff:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded');
      await C('kill @e[type=item]');
      await C('function mcleff:spawn');
      await sleep(300);
      await C('function mcleff:give');
      await sleep(T * 50 + 1500);
      await C('scoreboard players set #on mcleff 0');
      for (let k = 0; k < SCEN.length; k++) {
        const r = await C(`data get storage mcleff:r l${k}`);
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
  const golden = { pack: 'effects', version: '1.18.2', REPS, T, clock: 'NoAI mob -> /effect give (same tick as the log reset) -> Health every tick, entry i = after i+1 ticks',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'effects.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runeffect: ${golden.seconds} s -> ${join(dir, 'effects.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
