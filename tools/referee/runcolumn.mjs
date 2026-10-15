#!/usr/bin/env node
// runcolumn.mjs — the referee's COLUMN-PLANT growth runner (infra column-pack, 25 Sept 2026).
//
//   MCLITE_REFEREE_DIR=/root/ref-w node tools/referee/runcolumn.mjs
//
// Same shape as rungrowth.mjs: place every scenario's cells at tick 1, run `randomTickSpeed`
// random ticks/section/tick for T ticks (a real player parked in every scenario's own chunk via
// growbot.mjs, since `/forceload` alone never enables random ticks -- growthscen.mjs's own doc
// comment), and at each checkpoint count how many cells ARE the scenario's block at height 2 and
// height 3 above ground (columnscen.mjs's direct `execute if block` probe).
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/column-growth.json
//   { speed, checkpoints, cases: { "<scenario>": { cells, checkpoints: { "<ck>": { h2: n, h3: n } } } } }
//
// ⚠ MONOTONICITY GUARD (D-30/D-305): height 3 occupied implies height 2 occupied for a bottom-up
// column, so h3 <= h2 must hold for every scenario/checkpoint. This is exactly the shape of bug
// growthscen.mjs's dropped column probe produced (an impossible golden) -- refuse to write the
// golden file at all if it is violated, rather than shipping a check that would silently compare
// against a self-contradicting reference.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, serverPlan, origin, SPEED, CHECKPOINTS, GY } from './columnscen.mjs';

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/runcolumn: ${SCENARIOS.length} scenarios, ${plan.probes.length} probes, speed=${SPEED}, up to ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee column growth' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');

  const server = await startServer({ port: 25631, rconPort: 25632 });
  let rcon;
  const bots = [];
  const t0 = Date.now();
  const counts = {}, notes = [];
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
    for (let i = 0; i < SCENARIOS.length; i++) {
      const o = origin(i);
      const bot = await connectFakePlayer({ port: server.port, name: `refc${i}` });
      const tr = await rcon.command(`tp refc${i} ${o.x + 8} ${GY + 5} ${o.z + 8}`);
      if (!/^Teleported/.test(tr)) notes.push(`tp refc${i}: ${tr.trim().slice(0, 120)}`);
      bots.push(bot);
    }
    const stillUp = bots.filter((b) => !b.closed).length;
    if (stillUp !== SCENARIOS.length) notes.push(`only ${stillUp}/${SCENARIOS.length} referee players stayed connected`);
    await rcon.command('scoreboard players set #run mclr 1');
    await new Promise((r) => setTimeout(r, T * 50 + 2000));
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    const afterList = await rcon.command('list');
    const stillOnline = (afterList.match(/(\d+) of a max/) || [])[1];
    if (stillOnline && +stillOnline !== SCENARIOS.length) notes.push(`only ${stillOnline}/${SCENARIOS.length} referee players still online at the end: ${afterList.trim()}`);

    for (const sc of SCENARIOS) counts[sc.id] = { cells: sc.cells.length, checkpoints: {} };
    for (let j = 0; j < plan.probes.length; j++) {
      const p = plan.probes[j];
      const r = await rcon.command(`data get storage mcliteref:colgrow p${j}`);
      const m = /(-?\d+)\s*$/.exec(r.trim());
      if (!m) { notes.push(`${p.key}@${p.ck}: unreadable (${r.trim().slice(0, 80)})`); continue; }
      const n = parseInt(m[1], 10);
      const c = counts[p.scenario];
      const bucket = c.checkpoints[p.ck] || (c.checkpoints[p.ck] = {});
      bucket['h' + p.height] = n;
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }

  // ⚠ monotonicity guard — refuse to write an impossible golden (see this file's header).
  const violations = [];
  for (const sc of SCENARIOS) {
    const c = counts[sc.id];
    for (const ck of CHECKPOINTS) {
      const b = c.checkpoints[ck];
      if (!b) { violations.push(`${sc.id}@${ck}: missing sample`); continue; }
      if (b.h3 > b.h2) violations.push(`${sc.id}@${ck}: h3=${b.h3} > h2=${b.h2} (height>=3 implies height>=2 -- impossible golden)`);
    }
  }
  if (violations.length) {
    console.error('referee/runcolumn: REFUSING to write golden -- monotonicity violated:');
    for (const v of violations) console.error('  - ' + v);
    process.exit(1);
  }

  const golden = {
    pack: 'column-growth', version: '1.18.2', speed: SPEED, checkpoints: CHECKPOINTS,
    clock: 'place at tick 1; per checkpoint tick: count cells where `execute if block <pos> <block>` is true, direct (no marker-swap)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases: counts, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'column-growth.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runcolumn: ${Object.keys(counts).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
