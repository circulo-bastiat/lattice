#!/usr/bin/env node
// runconv.mjs — infra I6 (25 Sept 2026): golden for convrefcheck.mjs — MOB CONVERSIONS on the real 1.18.2 server.
// Scenarios: convscen.mjs. A datapack TICK function counts ticks (#t) and, per cell, stores the first #t at which the
// converted type is inside that cell, so the conversion tick is exact (no RCON timing in it): the tick function runs before
// the worlds tick (MinecraftServer.tickWorlds -> CommandFunctionManager.tick first), so a conversion during world tick n is
// first seen with #t = n + 1 -> recorded as n. Afterwards each converted mob's SNBT is read for baby/health/items/nausea.
//   node tools/referee/runconv.mjs            (~2 x 55 s of game time)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';
import { SCEN, T, PITCH, H } from './convscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPS = 2;
const FLOOR = -60;               // the flat world's grass is y -61; cells sit on it

export function summarize(nbt, to) {
  if (!nbt) return null;
  const idOf = (s) => (s && s.id ? String(s.id).replace('minecraft:', '') : '');
  const eff = (nbt.ActiveEffects || []).find((q) => Number(q.Id) === 9);
  const baby = to === 'zoglin' || to === 'zombified_piglin' || to === 'drowned' || to === 'zombie' || to === 'stray'
    ? (to === 'stray' ? false : !!Number(nbt.IsBaby || 0)) : Number(nbt.Age || 0) < 0;
  return {
    baby, health: Math.round(Number(nbt.Health) * 100) / 100,
    main: idOf((nbt.HandItems || [])[0]), head: idOf((nbt.ArmorItems || [])[3]),
    nausea: eff ? Number(eff.Duration) : 0,   // overwritten by the duration seen ON the conversion tick
  };
}

async function main() {
  const workDir = process.env.MCLITE_CONV_WORKDIR || join(homedir(), '.mclite-referee-conv');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteconv');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteconv', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee conversions' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteconv:tick'] }));
  const X = (k) => k * PITCH;
  const box = (k) => `x=${X(k)},y=${FLOOR},z=0,dx=0,dy=${H},dz=0`;
  const arena = [], spawn = ['scoreboard players set #t mc 0', 'scoreboard players set #run mc 1'], tick = [];
  tick.push('execute if score #run mc matches 1 run scoreboard players add #t mc 1');
  SCEN.forEach((s, k) => {
    const x = X(k);
    arena.push(`fill ${x - 1} ${FLOOR - 1} -1 ${x + 1} ${FLOOR + H} 1 minecraft:glass`,
      `fill ${x} ${FLOOR} 0 ${x} ${FLOOR + H - 1} 0 minecraft:air`);
    if (s.fill !== 'air') arena.push(`fill ${x} ${FLOOR} 0 ${x} ${FLOOR + (s.depth || 1) - 1} 0 minecraft:${s.fill}`);
    spawn.push(`scoreboard players set #d${k} mc -1`,
      `summon minecraft:${s.mob} ${x + 0.5} ${FLOOR} 0.5 {PersistenceRequired:1b,Tags:["cv${k}"]${s.nbt ? ',' + s.nbt : ''}}`);
    spawn.push(`scoreboard players set #n${k} mc 0`);
    tick.push(`execute if score #run mc matches 1 if score #d${k} mc matches -1 if entity @e[type=minecraft:${s.to},${box(k)}] store result score #n${k} mc run data get entity @e[type=minecraft:${s.to},${box(k)},limit=1] ActiveEffects[{Id:9b}].Duration`);
    tick.push(`execute if score #run mc matches 1 if score #d${k} mc matches -1 if entity @e[type=minecraft:${s.to},${box(k)}] run scoreboard players operation #d${k} mc = #t mc`);
  });
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), tick.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25651, rconPort: 26651, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, to: s.to, at: [], out: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doFireTick false', 'gamerule randomTickSpeed 0',
      'scoreboard objectives add mc dummy', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    for (let rep = 0; rep < REPS; rep++) {
      await C('scoreboard players set #run mc 0');
      await C('kill @e[type=!player]');
      await sleep(200);
      const a = await C('function mcliteconv:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
      await C('kill @e[type=item]');
      await C('function mcliteconv:spawn');
      await sleep(T * 50 + 1500);
      const tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
      await C('scoreboard players set #run mc 0');
      if (tNow < T) notes.push(`rep ${rep}: only ${tNow} ticks ran in the wait (server lagging) -- conversions after it read as -1`);
      for (let k = 0; k < SCEN.length; k++) {
        const s = SCEN[k];
        const d = +(/has (-?\d+)/.exec(await C(`scoreboard players get #d${k} mc`)) || [0, -1])[1];
        cases[s.id].at.push(d < 0 || d > T ? -1 : d - 1);
        const r = await C(`data get entity @e[type=minecraft:${s.to},${box(k)},limit=1]`);
        let o = null; if (d >= 0) { try { o = summarize(snbtOfReply(r), s.to); } catch (e) { o = { gone: true }; notes.push(`rep ${rep} ${s.id}: converted form no longer in the cell at the read (${r.slice(0, 60)})`); } }
        if (o && !o.gone) o.nausea = +(/has (-?\d+)/.exec(await C(`scoreboard players get #n${k} mc`)) || [0, 0])[1];
        cases[s.id].out.push(o);
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(24)} at ${c.at.join('/')}  ${JSON.stringify(c.out[0])}`); }
  const golden = { pack: 'conversion', version: '1.18.2', REPS, T, clock: 'summon (AI on, persistent) -> first world tick the converted type is in the cell (tick function, exact); -1 = never in T',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'conversion.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runconv: ${golden.seconds} s -> ${join(dir, 'conversion.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
