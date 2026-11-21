#!/usr/bin/env node
// runmobhazard.mjs — the referee's MOB DROWNING / AIR SUPPLY runner (infra W). Scenarios: mobhazardscen.mjs.
//   node tools/referee/runmobhazard.mjs      # 11 scenarios x REPS, submerged land mobs + OOW water mobs
// Per rep: kill, arena, summon every NoAI-off (AI-on) mob, then ONE function that places every pen's water/lid
// (and gives the Water Breathing effect where the scenario asks for it) and resets the per-lane Health+Air logs
// in the same server tick; a datapack tick function appends each lane's Health AND the NBT short `Air` every tick
// (entry i = after i ticks); ONE bounded wait on the server WE started (not polling, D-436); read every log. Own
// port 25681 + work dir (MCLITE_MOBHAZARD_WORKDIR, default ~/.mclite-referee-mobhazard); golden -> <referee dir>/golden/mobhazard.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, REPS, PITCH, T } from './mobhazardscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
const maxT = Math.max(...SCEN.map((s) => s.t || T));

async function main() {
  const workDir = process.env.MCLITE_MOBHAZARD_WORKDIR || join(homedir(), '.mclite-referee-mobhazard');
  const dp = join(workDir, 'world', 'datapacks', 'mclmh');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclmh', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee mob hazards' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclmh:tick'] }));
  const X = (k) => k * PITCH;
  const arena = [], spawn = [], give = [], tick = [];
  SCEN.forEach((s, k) => {
    const x = X(k);
    // walls to PAD+4 (floor, feet, head, lid) so a `lid` scenario has a real ceiling over the head cell.
    arena.push(`fill ${x - 1} ${PAD} -1 ${x + 1} ${PAD + 4} 1 minecraft:glass`, `fill ${x} ${PAD + 1} 0 ${x} ${PAD + 4} 0 minecraft:air`,
      ...(s.floor ? [`setblock ${x} ${PAD} 0 minecraft:${s.floor}`] : []));
    spawn.push(`summon minecraft:${s.mob} ${x + 0.5} ${s.y !== undefined ? s.y : PAD + 1} 0.5 {PersistenceRequired:1b,Silent:1b,Tags:["ef${k}"]${s.y !== undefined ? ',NoGravity:1b' : ''}}`);
    if (s.at) give.push(`setblock ${x} ${PAD + 1} 0 minecraft:${s.at}`);
    if (s.head) give.push(`setblock ${x} ${PAD + 2} 0 minecraft:${s.head}`);
    if (s.lid) give.push(`setblock ${x} ${PAD + 3} 0 minecraft:${s.lid}`);
    if (s.ty !== undefined) give.push(`tp @e[tag=ef${k},limit=1] ${x + 0.5} ${s.ty} 0.5`);
    if (s.fire) give.push(`data merge entity @e[tag=ef${k},limit=1] {Fire:${s.fire * 20}s}`);
    if (s.effect) give.push(`effect give @e[tag=ef${k},limit=1] minecraft:${s.effect} 1000000 0 true`);
    tick.push(`execute if score #on mclmh matches 1 run data modify storage mclmh:r l${k} append from entity @e[tag=ef${k},limit=1] Health`);
    tick.push(`execute if score #on mclmh matches 1 run data modify storage mclmh:r a${k} append from entity @e[tag=ef${k},limit=1] Air`);
    tick.push(`execute if score #on mclmh matches 1 run data modify storage mclmh:r f${k} append from entity @e[tag=ef${k},limit=1] Fire`);
  });
  give.push('data remove storage mclmh:r l0');
  SCEN.forEach((s, k) => give.push(`data modify storage mclmh:r l${k} set value []`, `data modify storage mclmh:r a${k} set value []`, `data modify storage mclmh:r f${k} set value []`));
  give.push('scoreboard players set #on mclmh 1');
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'give.mcfunction'), give.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25681, rconPort: 26681, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, t: s.t || T, series: [], airSeries: [], fireSeries: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'scoreboard objectives add mclmh dummy', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`, 'reload']) { try { await C(c); } catch (e) { /* ok */ } }
    await sleep(1500);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #on mclmh 0');
      await C('kill @e[type=!player]');
      await sleep(150);
      const a = await C('function mclmh:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
      await C('kill @e[type=item]');
      await C('function mclmh:spawn');
      await sleep(300);
      await C('function mclmh:give');
      await sleep(maxT * 50 + 1500);
      await C('scoreboard players set #on mclmh 0');
      for (let k = 0; k < SCEN.length; k++) {
        const r = await C(`data get storage mclmh:r l${k}`);
        const m = /\[(.*)\]/s.exec(r);
        const arr = m && m[1].trim() ? m[1].split(',').map((q) => parseFloat(q)) : [];
        const tk = SCEN[k].t || T;
        cases[SCEN[k].id].series.push(arr.slice(0, tk));
        const ra = await C(`data get storage mclmh:r a${k}`);
        const ma = /\[(.*)\]/s.exec(ra);
        const arra = ma && ma[1].trim() ? ma[1].split(',').map((q) => parseInt(q, 10)) : [];
        cases[SCEN[k].id].airSeries.push(arra.slice(0, tk));
        const rf = await C(`data get storage mclmh:r f${k}`);
        const mf = /\[(.*)\]/s.exec(rf);
        cases[SCEN[k].id].fireSeries.push(mf && mf[1].trim() ? mf[1].split(',').map((q) => parseInt(q, 10)).slice(0, tk) : []);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) {
    const c = cases[s.id];
    console.log(`  ${s.id.padEnd(22)} ${c.series.map((q) => `${q.length}t hp${q[0]}->${q[q.length - 1]}`).join(' | ')} ` +
      `air ${c.airSeries.map((q) => `${q[0]}->${q[q.length - 1]}`).join(' | ')}`);
  }
  const golden = { pack: 'mobhazard', version: '1.18.2', REPS, T, clock: 'AI-on mob in a 1x1 pen -> water/lid placed (same tick as ' +
    'the log reset) -> Health AND the NBT short Air every tick, entry 0 = before any world tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mobhazard.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runmobhazard: ${golden.seconds} s -> ${join(dir, 'mobhazard.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
