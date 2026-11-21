#!/usr/bin/env node
// runsurvive.mjs — the referee's COLUMN-PLANT SURVIVAL runner (infra referee-survive, 25 Sept 2026).
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runsurvive.mjs      # the real server, ~15 s
//
// No fake player needed (unlike runcolumn.mjs/runleaf.mjs's growth checks): scheduled ticks --
// which is all cactus/cane survival ever uses -- keep flowing in a forceloaded chunk with nobody
// watching it (growbot.mjs's own header: only RANDOM ticks need a real player). A `#minecraft:tick`
// function places every scenario at tick 1, makes the ONE support-breaking change at TRIGGER, and
// appends a boolean presence sample for every probe cell every tick (survivescen.mjs's clock). We
// wait once for T ticks on a server WE started, then read every probe's series once (D-436).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/column-survive.json
//   { trigger, T, cases: { "<scenario>": { cells: [[dx,dy,dz],...], series: [[0/1 x T], ...] } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCENARIOS, serverPlan, TRIGGER, T as SCEN_T } from './survivescen.mjs';

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/runsurvive: ${SCENARIOS.length} scenarios, ${plan.probes.length} probes, TRIGGER=${TRIGGER}, ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee column survival' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');

  const server = await startServer({ port: 25711, rconPort: 25712 });
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
    for (const c of plan.setup) {
      const r = await rcon.command(c);
      if (/Unknown|Invalid|Incorrect|Could not|expected|error/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    for (let j = 0; j < plan.probes.length; j++) await rcon.command(`data modify storage mcliteref:surv p${j} set value []`);
    await rcon.command('scoreboard players set #run mclr 1');
    // the ONE bounded wait for our own run (D-436): T*50ms*2 + 5s margin -- CPU is shared with
    // another referee server running concurrently.
    await new Promise((r) => setTimeout(r, T * 50 * 2 + 5000));
    let tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) {
      // rerun ONCE if the tick counter did not reach T (project rule: never a wait loop, never poll)
      notes.push(`first attempt: tick counter did not reach T (${tr.trim()}) -- rerunning once`);
      await rcon.command('scoreboard players set #run mclr 0');
      await rcon.command('scoreboard players set #t mclr 0');
      for (let j = 0; j < plan.probes.length; j++) await rcon.command(`data modify storage mcliteref:surv p${j} set value []`);
      await rcon.command('scoreboard players set #run mclr 1');
      await new Promise((r) => setTimeout(r, T * 50 * 2 + 5000));
      tr = await rcon.command('scoreboard players get #t mclr');
      if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T on rerun: ' + tr);
    }
    await rcon.command('scoreboard players set #run mclr 0');

    for (const sc of SCENARIOS) cases[sc.id] = { cells: sc.probes, series: sc.probes.map(() => null) };
    for (let j = 0; j < plan.probes.length; j++) {
      const p = plan.probes[j];
      const r = await rcon.command(`data get storage mcliteref:surv p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const vals = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 10)) : [];
      if (vals.length !== T) notes.push(`${p.key}: read ${vals.length}/${T} samples (${r.trim().slice(0, 80)})`);
      const [id, pk] = p.key.split('.');
      const idx = parseInt(pk.slice(1), 10);
      cases[id].series[idx] = vals;
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }

  // item drops: NOT collected -- doTileDrops/entity counting adds another RCON round trip per
  // probe per tick for a question this pack does not need answered (existence, not drops); the
  // task explicitly allows skipping this and saying so. Skipped.
  notes.push('item-drop counts: skipped (existence/timing is this pack\'s question, not drop counts)');

  const golden = {
    pack: 'column-survive', version: '1.18.2', trigger: TRIGGER, T,
    clock: 'per tick k: (k==1 place)(k==TRIGGER the one change) -> sample every probe cell (boolean, still the plant) -> one world tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'column-survive.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runsurvive: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
