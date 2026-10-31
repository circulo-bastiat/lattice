#!/usr/bin/env node
// runarrow.mjs — the referee's ARMOR runner (infra I6, 25 Sept 2026). Scenarios: armorscen.mjs.
//   node tools/referee/runarrow.mjs      # arrow scenarios x REPS, ~1 min
// Per rep: kill, summon every NoAI target (one function), read Health, summon every arrow (one function), ONE bounded
// T-tick wait on the server WE started (not polling, D-436), read Health again. Night, no spawning, no weather.
// Own port 25644 + work dir (MCLITE_ARROW_WORKDIR, default ~/.mclite-referee-arrow); golden -> <referee dir>/golden/arrow.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCEN, REPS, PITCH, T, HIT_Y, START_DZ, armorNbt } from './arrowscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
async function main() {
  const workDir = process.env.MCLITE_ARROW_WORKDIR || join(homedir(), '.mclite-referee-arrow');
  const dp = join(workDir, 'world', 'datapacks', 'mclitearr');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitearr', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee armor' } }));
  const X = (k) => k * PITCH;
  const arena = [], targets = [], arrows = [];
  SCEN.forEach((s, k) => {
    const x = X(k);
    arena.push(`fill ${x - 3} ${PAD} -5 ${x + 3} ${PAD + 5} 5 minecraft:air`, `fill ${x - 3} ${PAD} -5 ${x + 3} ${PAD} 5 minecraft:stone`);
    const eff = s.resist !== undefined ? `,ActiveEffects:[{Id:11b,Amplifier:${s.resist}b,Duration:100000,ShowParticles:0b}]` : '';
    targets.push(`summon minecraft:${s.mob} ${x + 0.5} ${PAD + 1} 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["arr${k}"],${armorNbt(s)}${eff}}`);
    arrows.push(`summon minecraft:arrow ${x + 0.5} ${PAD + 1 + HIT_Y} ${0.5 + START_DZ} {Motion:[0.0d,0.0d,${s.v}d],damage:${s.d}d,crit:${s.crit ? 1 : 0}b,pickup:0b,Tags:["arrA${k}"]}`);
  });
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');
  writeFileSync(join(fdir, 'targets.mcfunction'), targets.join('\n') + '\n');
  writeFileSync(join(fdir, 'arrows.mcfunction'), arrows.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25644, rconPort: 26644, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { mob: s.mob, before: [], after: [] };
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', `forceload add -16 -16 ${X(SCEN.length) + 16} 16`]) await C(c);
    await sleep(1500);
    const health = async (k) => {
      const r = await C(`data get entity @e[tag=arr${k},limit=1] Health`);
      const m = /data:\s*([-0-9.Ee]+)f/.exec(r);
      return m ? parseFloat(m[1]) : (/No entity/i.test(r) ? -1 : NaN);
    };
    for (let rep = 0; rep < REPS; rep++) {
      await C('kill @e[type=!player]');
      await sleep(150);
      const a = await C('function mclitearr:arena');
      if (/Unknown function/i.test(a)) throw new Error('datapack not loaded');
      await C('kill @e[type=item]');
      await C('function mclitearr:targets');
      await sleep(300);
      const before = [];
      for (let k = 0; k < SCEN.length; k++) before.push(await health(k));
      await C('function mclitearr:arrows');
      await sleep(T * 50 + 500);
      for (let k = 0; k < SCEN.length; k++) {
        const s = SCEN[k];
        cases[s.id].before.push(before[k]);
        cases[s.id].after.push(await health(k));
      }
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of SCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(28)} health before ${c.before.join('/')} after ${c.after.join('/')}`); }
  const golden = { pack: 'arrow', version: '1.18.2', REPS, T, clock: 'NoAI target -> Health -> one arrow -> T ticks -> Health (float, as /data prints it); -1 = gone',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'arrow.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runarrow: ${golden.seconds} s -> ${join(dir, 'arrow.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
