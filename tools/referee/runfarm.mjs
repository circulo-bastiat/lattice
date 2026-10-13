#!/usr/bin/env node
// runfarm.mjs — the referee's FARMLAND MOISTURE runner (infra I6, 25 Sept 2026). Scenarios + clock: farmscen.mjs.
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runfarm.mjs      # ~1 min, the real server
//
// A `#minecraft:tick` function places every scenario (tick 1) and, every EVERY ticks, samples dirt/m0..m7 counts into
// storage. Random ticks need a REAL player watching each chunk (growbot.mjs's doc comment), so one fake player is
// parked above every scenario. We wait once for T ticks on a server WE started, then read the counter once (D-436).
// After the run, every cell's final state is read over RCON (`execute if block ... dirt | farmland[moisture=k]`).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/farmland-moisture.json
//   { speed, every, T, cases: { "<id>": { dirt: [..], m0..m7: [..] (T/EVERY samples), final: ['d' dirt | 'g' grass | moisture per cell] } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, serverPlan, origin, SPEED, EVERY, GY, LABELS } from './farmscen.mjs';

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/runfarm: ${SCENARIOS.length} scenarios, ${plan.keys.length} probes, speed=${SPEED}, ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee farmland' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');

  const server = await startServer({ port: 25623, rconPort: 25624 });
  let rcon;
  const bots = [];
  const t0 = Date.now();
  const cases = {}, notes = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    const fn = await rcon.command('function mcliteref:gate');
    if (/Unknown function/i.test(fn)) throw new Error('datapack not loaded: ' + fn);
    await rcon.command('scoreboard objectives add mclr dummy');
    await rcon.command('scoreboard players set #run mclr 0');
    await rcon.command('scoreboard players set #t mclr 0');
    for (const c of plan.setup) {
      const r = await rcon.command(c);
      if (/Unknown|Invalid|Incorrect|Could not|expected|error|Too many|not loaded/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    for (let i = 0; i < SCENARIOS.length; i++) {
      const o = origin(i);
      bots.push(await connectFakePlayer({ port: server.port, name: `farm${i}` }));
      const tr = await rcon.command(`tp farm${i} ${o.x + 8} ${GY + 14} ${o.z + 8}`);
      if (!/^Teleported/.test(tr)) notes.push(`tp farm${i}: ${tr.trim().slice(0, 120)}`);
    }
    await rcon.command('scoreboard players set #run mclr 1');
    await new Promise((r) => setTimeout(r, T * 50 + 3000));   // the ONE bounded wait for our own run (D-436)
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    const online = +((await rcon.command('list')).match(/There are (\d+)/) || [])[1];
    if (online !== SCENARIOS.length) notes.push(`only ${online}/${SCENARIOS.length} referee players online at the end`);

    for (let j = 0; j < plan.keys.length; j++) {
      const [id, what] = plan.keys[j].split('.');
      const r = await rcon.command(`data get storage mcliteref:farm p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const vals = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 10)) : [];
      if (vals.length !== Math.floor(T / EVERY)) notes.push(`${plan.keys[j]}: read ${vals.length}/${Math.floor(T / EVERY)} samples (${r.trim().slice(0, 80)})`);
      (cases[id] || (cases[id] = {}))[what] = vals;
    }
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i], o = origin(i), fin = [];
      for (const [x, z] of sc.cells) {
        const at = `${o.x + x} ${GY} ${o.z + z}`;
        let v = '?';
        if (/passed/i.test(await rcon.command(`execute if block ${at} minecraft:dirt`))) v = 'd';
        else if (/passed/i.test(await rcon.command(`execute if block ${at} minecraft:grass_block`))) v = 'g';
        else for (let k = 0; k <= 7; k++) if (/passed/i.test(await rcon.command(`execute if block ${at} minecraft:farmland[moisture=${k}]`))) { v = k; break; }
        fin.push(v);
      }
      cases[sc.id].final = fin;
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'farmland-moisture', version: '1.18.2', speed: SPEED, every: EVERY, T,
    clock: 'per tick k: (k==1 place) -> (k%EVERY==0 sample dirt,m0..m7) -> one world tick; final state per cell after T (d dirt, g grass_block -- vanilla grass spreads onto the dirt)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'farmland-moisture.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runfarm: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
