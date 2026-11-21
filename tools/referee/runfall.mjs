#!/usr/bin/env node
// runfall.mjs — the referee's FALL DAMAGE runner (infra I6, 25 Sept 2026). Scenarios: fallscen.mjs.
//
//   node tools/referee/runfall.mjs      # 23 scenarios x REPS, ~1 min
//
// Per rep: rebuild every glass shaft + landing pad (one datapack function), summon every mob (one function), read every
// mob's Health x100 into storage (one function), ONE bounded 80-tick wait on the server WE started (not polling, D-436),
// read again. A mob that is gone (died) reads -1. Night, no daylight cycle (undead do not burn), no mob spawning.
// Own port 25641 + work dir (MCLITE_FALL_WORKDIR, default ~/.mclite-referee-fall); golden -> <referee dir>/golden/fall.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, REPS, T, PITCH } from './fallscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;                // landing pad y (the flat world's grass is y -61)

async function main() {
  const workDir = process.env.MCLITE_FALL_WORKDIR || join(homedir(), '.mclite-referee-fall');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitefall');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitefall', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee fall damage' } }));
  const X = (k) => k * PITCH;
  const arena = [], spawn = [], rd = (key) => [`data modify storage mclitefall:r ${key} set value [${SCEN.map(() => '-1').join(',')}]`];
  const readB = rd('b'), readA = rd('a');
  SCEN.forEach((s, k) => {
    const x = X(k);
    arena.push(`fill ${x - 2} ${PAD} -2 ${x + 2} ${PAD + s.h + 3} 2 minecraft:glass`,
      `fill ${x - 1} ${PAD + 1} -1 ${x + 1} ${PAD + s.h + 3} 1 minecraft:air`,
      `fill ${x - 1} ${PAD} -1 ${x + 1} ${PAD} 1 minecraft:${s.land}`);
    spawn.push(`summon minecraft:${s.mob} ${x + 0.5} ${PAD + 1 + s.h} 0.5 {PersistenceRequired:1b,Motion:[0.0d,0.0d,0.0d]${s.nbt ? ',' + s.nbt : ''}}`);
    const sel = `@e[type=minecraft:${s.mob},x=${x - 1},y=${PAD - 1},z=-1,dx=2,dy=${s.h + 5},dz=2,limit=1]`;
    readB.push(`execute store result storage mclitefall:r b[${k}] int 100 run data get entity ${sel} Health`);
    readA.push(`execute store result storage mclitefall:r a[${k}] int 100 run data get entity ${sel} Health`);
  });
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'spawn.mcfunction'), spawn.join('\n') + '\n');
  writeFileSync(join(fdir, 'readb.mcfunction'), readB.join('\n') + '\n');
  writeFileSync(join(fdir, 'reada.mcfunction'), readA.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25641, rconPort: 26641, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, h: s.h, land: s.land, before: [], after: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    const list = (r) => { const m = /\[(.*)\]/s.exec(r); return m ? m[1].split(',').map((q) => parseInt(q.trim(), 10)) : []; };
    for (let rep = 0; rep < REPS; rep++) {
      await C('kill @e[type=!player]');
      await sleep(150);
      const a = await C('function mclitefall:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded');
      await C('kill @e[type=item]');
      await C('function mclitefall:spawn');
      await C('function mclitefall:readb');
      await sleep(T * 50 + 500);
      await C('function mclitefall:reada');
      const b = list(await C('data get storage mclitefall:r b')), af = list(await C('data get storage mclitefall:r a'));
      if (b.length !== SCEN.length || af.length !== SCEN.length) { notes.push(`rep ${rep}: unreadable storage`); continue; }
      SCEN.forEach((s, k) => { cases[s.id].before.push(b[k]); cases[s.id].after.push(af[k]); });
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(18)} health x100 before ${c.before.join('/')} after ${c.after.join('/')}`); }
  const golden = { pack: 'fall', version: '1.18.2', REPS, T, scale: 100, clock: 'summon (AI on) -> read Health -> 80 ticks -> read; -1 = gone (died)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fall.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runfall: ${golden.seconds} s -> ${join(dir, 'fall.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
