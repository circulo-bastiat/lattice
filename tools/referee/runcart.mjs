#!/usr/bin/env node
// runmotion.mjs — the referee's ENTITY MOTION runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runcart.mjs        # every scenario in cartscen.mjs, ~40 s
//
// Clears the area over RCON, then starts a `#minecraft:tick` function that, per tick: counts, places every
// scenario's entity (tick 1), and appends the probes (Pos/Motion x 10000, alive, landed block) to storage -- functions run BEFORE the worlds tick, where a player's
// action lands, so the log is tick-exact and nothing here reads a clock over RCON. The run stops itself after
// T ticks; we wait for that ONE bounded event (the counter reaching T) on a server WE started -- not polling a
// queue (D-436).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/cart-motion.json
//   { T, cases: { "<scenario>": { probes: { <label>: [values..] } } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCENARIOS, serverPlan, T as TT } from './cartscen.mjs';

async function main() {
  const plan = serverPlan();
  const T = TT;
  console.log(`referee/runcart: ${SCENARIOS.length} scenarios, ${plan.probes.length} probes, up to ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee minecart motion' } }));
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
    await rcon.command('data remove storage mcliteref:mo p0');
    for (const c of plan.setup) {
      const r = await rcon.command(c);
      if (/Unknown|Invalid|Incorrect|Could not|expected|error/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    for (let j = 0; j < plan.probes.length; j++) await rcon.command(`data modify storage mcliteref:mo p${j} set value []`);
    await rcon.command('scoreboard players set #run mclr 1');
    // the run takes T ticks = T/20 s; wait for it once, then read the counter ONCE to prove it finished
    await new Promise((r) => setTimeout(r, T * 50 + 6000));
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    const logs = [];
    for (let j = 0; j < plan.probes.length; j++) {
      const r = await rcon.command(`data get storage mcliteref:mo p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const vals = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => Math.round(parseFloat(s))) : [];
      const want = T;
      if (vals.length !== want) notes.push(`${plan.probes[j]}: read ${vals.length}/${want} samples (${r.trim().slice(0, 80)})`);
      logs.push(vals);
    }
    plan.probes.forEach((key, j) => {
      const [id, label] = key.split('.');
      const c = cases[id] || (cases[id] = { probes: {} });
      c.probes[label] = logs[j];
    });
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'cart-motion', version: '1.18.2', T,
    clock: 'placed + settled before the run; per tick: events for k -> sample (log[k-1]) -> one world tick; tick function, before the worlds tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'cart-motion.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runcart: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
