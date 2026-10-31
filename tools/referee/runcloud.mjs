#!/usr/bin/env node
// runcloud.mjs — the referee's LINGERING-CLOUD runner (#6081). Scenario: cloudscen.mjs.  node tools/referee/runcloud.mjs
// A tick function (minecraft:tick tag) appends {age, r, <victim>: {h, d}} to storage mcl:c log every server tick while the
// cloud exists; the log is read back entry by entry. Own port 25644 + work dir (MCLITE_CLOUD_WORKDIR); golden -> golden/cloud.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { VICTIMS, TICKS, cloudNbt } from './cloudscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = -60;
async function main() {
  const workDir = process.env.MCLITE_CLOUD_WORKDIR || join(homedir(), '.mclite-referee-cloud');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitecld');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitecld', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee cloud' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitecld:log'] }));
  const logLines = ['execute unless entity @e[tag=clc,limit=1] run return 0'];   // 1.18.2 has no `return`; guarded per line below
  logLines.length = 0;
  const g = 'execute if entity @e[tag=clc,limit=1] run ';
  logLines.push(g + 'data modify storage mcl:c cur set value {}');
  logLines.push(g + 'data modify storage mcl:c cur.age set from entity @e[tag=clc,limit=1] Age');
  logLines.push(g + 'data modify storage mcl:c cur.r set from entity @e[tag=clc,limit=1] Radius');
  for (const v of VICTIMS) {
    logLines.push(g + `data modify storage mcl:c cur.${v.id}h set from entity @e[tag=v${v.id},limit=1] Health`);
    logLines.push(g + `data modify storage mcl:c cur.${v.id}d set from entity @e[tag=v${v.id},limit=1] ActiveEffects[0].Duration`);
  }
  logLines.push(g + 'data modify storage mcl:c log append from storage mcl:c cur');
  writeFileSync(join(fdir, 'log.mcfunction'), logLines.join('\n') + '\n');
  const setup = [`fill -6 ${PAD} -6 6 ${PAD + 5} 6 minecraft:air`, `fill -6 ${PAD} -6 6 ${PAD} 6 minecraft:stone`,
    'data modify storage mcl:c log set value []'];
  for (const v of VICTIMS) setup.push(`summon minecraft:${v.mob} ${0.5 + v.dx} ${PAD + 1} 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["v${v.id}"]}`);
  writeFileSync(join(fdir, 'setup.mcfunction'), setup.join('\n') + '\n');
  const server = await startServer({ workDir, port: 25644, rconPort: 26644, xmx: '1024M' });
  const t0 = Date.now();
  let rcon, log = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'forceload add -16 -16 16 16']) await C(c);
    await sleep(1500);
    await C('kill @e[type=!player]');
    await sleep(150);
    if (/Unknown function/i.test(await C('function mclitecld:setup'))) throw new Error('datapack not loaded');
    await sleep(300);
    await C(`summon minecraft:area_effect_cloud 0.5 ${PAD + 1} 0.5 {${cloudNbt}}`);
    await sleep(TICKS * 50 + 1500);
    for (let k = 0; k < TICKS; k++) {
      const r = await C(`data get storage mcl:c log[${k}]`);
      const m = /contents:\s*(\{.*\})\s*$/s.exec(r);
      if (!m) { console.log(`  entry ${k}: ${r}`); break; }
      const o = {};
      for (const f of m[1].matchAll(/(\w+):\s*(-?[0-9.Ee]+)[fdbsL]?/g)) o[f[1]] = parseFloat(f[2]);
      log.push(o);
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'cloud', version: '1.18.2', TICKS, clock: 'tick function log per server tick: age, r, <victim>h Health, <victim>d poison Duration (absent = none)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), log };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cloud.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runcloud: ${log.length} ticks logged, ${golden.seconds} s -> ${join(dir, 'cloud.json')}`);
  console.log(log.slice(0, 40).map((o) => JSON.stringify(o)).join('\n'));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
