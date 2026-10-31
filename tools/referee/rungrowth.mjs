#!/usr/bin/env node
// rungrowth.mjs — the referee's GROWTH TIMING runner (infra I6, random-tick growth, 24 Sept 2026).
//
//   MCLITE_REFEREE_DIR=/home/claude/ref-w node tools/referee/rungrowth.mjs
//
// Growth is random (`randomTickSpeed` positions/section/tick), so unlike runhopper/runredstone/
// runfurnace this does not log a tick-exact series: it places every scenario's cells at tick 1, lets
// `gamerule randomTickSpeed growthscen.SPEED` run for T ticks, and at each checkpoint fills every
// matching (block, state) cell through a one-tick `minecraft:glass` marker swap to read vanilla's own
// "N block(s) filled" count (see growthscen.mjs's serverPlan doc comment for why a same-state `fill
// ... replace` cannot be read directly) into NBT storage.
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/growth-timing.json
//   { speed, checkpoints, cases: { "<scenario>": { kind, cells, checkpoints: { "<ck>": {"s<v>"|"e<h>": n, ...} } } } }
//   crop/stage scenarios key by "s<age or stage value>"; tall (bamboo, #304) by "h<layer>", the PRESENT count at GY+layer;
//   column scenarios key by "e<height layer>", the
//   EMPTY-cell count at that layer (growthrefcheck.mjs derives presence as cells - e<h>).
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, serverPlan, origin, SPEED, CHECKPOINTS, GY } from './growthscen.mjs';

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/rungrowth: ${SCENARIOS.length} scenarios, ${plan.probes.length} probes, speed=${SPEED}, up to ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee growth timing' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');
  for (const [fn, lines] of Object.entries(plan.fns || {})) writeFileSync(join(fdir, fn + '.mcfunction'), lines.join('\n') + '\n'); // #305 stem probes

  const server = await startServer({ port: 25611, rconPort: 25612 });
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
      if (/Unknown|Invalid|Incorrect|Could not|expected|error|Too many/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    // ⚠ growbot.mjs's doc comment: `/forceload` alone never enables random ticks -- a REAL player
    // must be watching each scenario's chunk, and (see growthscen.mjs) that watched window does not
    // reliably follow `/tp` past a handful of chunks from spawn, so one bot is parked in EVERY
    // scenario's own chunk rather than trusting one bot's view distance to cover several.
    for (let i = 0; i < SCENARIOS.length; i++) {
      const o = origin(i);
      const bot = await connectFakePlayer({ port: server.port, name: `ref${i}` });
      const tr = await rcon.command(`tp ref${i} ${o.x + 8} ${GY + 5} ${o.z + 8}`);
      if (!/^Teleported/.test(tr)) notes.push(`tp ref${i}: ${tr.trim().slice(0, 120)}`);
      bots.push(bot);
    }
    const stillUp = bots.filter((b) => !b.closed).length;
    if (stillUp !== SCENARIOS.length) notes.push(`only ${stillUp}/${SCENARIOS.length} referee players stayed connected`);
    await rcon.command('scoreboard players set #run mclr 1');
    // the run takes T ticks = T/20 s; wait for it once, then read the counter ONCE to prove it finished
    await new Promise((r) => setTimeout(r, T * 50 + 2000));
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    const afterList = await rcon.command('list');
    const stillOnline = (afterList.match(/(\d+) of a max/) || [])[1];
    if (stillOnline && +stillOnline !== SCENARIOS.length) notes.push(`only ${stillOnline}/${SCENARIOS.length} referee players still online at the end: ${afterList.trim()}`);

    for (const sc of SCENARIOS) counts[sc.id] = { kind: sc.kind, cells: sc.cells.length, checkpoints: {} };
    for (let j = 0; j < plan.probes.length; j++) {
      const p = plan.probes[j];
      const r = await rcon.command(`data get storage mcliteref:grow p${j}`);
      const m = /(-?\d+)\s*$/.exec(r.trim());
      if (!m) { notes.push(`${p.key}@${p.ck}: unreadable (${r.trim().slice(0, 80)})`); continue; }
      const n = parseInt(m[1], 10);
      const c = counts[p.scenario];
      const bucket = c.checkpoints[p.ck] || (c.checkpoints[p.ck] = {});
      bucket[p.layer !== undefined ? 'h' + p.layer : p.height !== undefined ? (c.kind === 'stem' ? 'h' : 'e') + p.height : p.state === 'logs' ? 'logs' : 's' + p.state] = n;
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = {
    pack: 'growth-timing', version: '1.18.2', speed: SPEED, checkpoints: CHECKPOINTS,
    clock: 'place at tick 1; per checkpoint tick: fill <box> <block> replace <block>[<prop>=<v>] -> store result (count) in storage',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases: counts, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'growth-timing.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/rungrowth: ${Object.keys(counts).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
