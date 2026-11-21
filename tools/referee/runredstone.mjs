#!/usr/bin/env node
// runredstone.mjs — the referee's REDSTONE TIMING runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runredstone.mjs      # every scenario in redstonescen.mjs, ~1 min
//
// Builds each circuit with /setblock over RCON, lets the world settle 30 ticks, then starts a `#minecraft:tick`
// function that, per tick: counts, applies the scenario's trigger toggles, and appends every probe's
// `execute if block <pos> <state>` result to storage -- functions run BEFORE the worlds tick, where a player's
// action lands, so the log is tick-exact and nothing here reads a clock over RCON. The run stops itself after
// T ticks; we wait for that ONE bounded event (the counter reaching T) on a server WE started -- not polling a
// queue (D-436).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/redstone-timing.json
//   { T, cases: { "<scenario>": { events, probes: { "<label>": "0001111..." } } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCENARIOS, T, serverPlan } from './redstonescen.mjs';

async function main() {
  const plan = serverPlan();
  console.log(`referee/runredstone: ${SCENARIOS.length} scenarios, ${plan.probes.length} probes x ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee redstone timing' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');
  // one probe per `data get`, so no RCON reply is ever cut
  const server = await startServer({});
  let rcon;
  const t0 = Date.now();
  const cases = {}, notes = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    const fnList = await rcon.command('function mcliteref:gate');
    if (/Unknown function/i.test(fnList)) throw new Error('datapack not loaded: ' + fnList);
    await rcon.command('scoreboard objectives add mclr dummy');
    await rcon.command('scoreboard players set #run mclr 0');
    await rcon.command('scoreboard players set #t mclr 0');
    await rcon.command('data remove storage mcliteref:red p0');
    for (const c of plan.setup) {
      const r = await rcon.command(c);
      if (/Unknown|Invalid|Incorrect|Could not|expected|error/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    for (let j = 0; j < plan.probes.length; j++) await rcon.command(`data modify storage mcliteref:red p${j} set value []`);
    // settle: 30 real ticks (1.5 s) -- a bounded sleep on a fresh build, not a poll of a result
    await new Promise((r) => setTimeout(r, 1500));
    await rcon.command('scoreboard players set #run mclr 1');
    // the run takes T ticks = T/20 s; wait for it once, then read the counter ONCE to prove it finished
    await new Promise((r) => setTimeout(r, T * 50 + 1500));
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    const logs = [];
    for (let j = 0; j < plan.probes.length; j++) {
      const r = await rcon.command(`data get storage mcliteref:red p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const bits = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s === '1b' ? '1' : '0')).join('') : '';
      if (bits.length !== T) notes.push(`${plan.probes[j]}: read ${bits.length}/${T} samples (${r.trim().slice(0, 80)})`);
      logs.push(bits);
    }
    plan.probes.forEach((key, j) => {
      const [id, label] = key.split('.');
      const sc = SCENARIOS.find((s) => s.id === id);
      const c = cases[id] || (cases[id] = { events: sc.events, probes: {} });
      c.probes[label] = logs[j];
    });
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'redstone-timing', version: '1.18.2', T,
    clock: 'per tick: toggles for tick k -> sample (log[k-1]) -> one world tick; tick function, before the worlds tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'redstone-timing.json');
  writeFileSync(out, JSON.stringify(golden, null, 1) + '\n');
  console.log(`referee/runredstone: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
