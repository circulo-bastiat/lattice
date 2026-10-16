#!/usr/bin/env node
// runleaf.mjs — the referee's LEAF DECAY runner (infra I6, 25 Sept 2026). Scenarios + clock: leafscen.mjs.
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runleaf.mjs      # ~1 min, the real server
//
// A `#minecraft:tick` function places every scenario (tick 1), cuts the logs (tick CUT) and samples n / d7 per tick into
// storage. Random ticks need a REAL player watching each chunk (growbot.mjs's doc comment), so one fake player is
// parked above every scenario. We wait once for T ticks on a server WE started, then read the counter once (D-436).
// After the run, every leaf cell's final DISTANCE is read over RCON (`execute if block ... [distance=k]`).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/leaf-decay.json
//   { speed, cut, T, cases: { "<id>": { n: [..T], d7: [..T], final: [distance|0 per leaf cell] } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, serverPlan, origin, SPEED, CUT, GY, LEAF } from './leafscen.mjs';

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/runleaf: ${SCENARIOS.length} scenarios, ${plan.keys.length} probes, speed=${SPEED}, ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee leaf decay' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');

  const server = await startServer({ port: 25621, rconPort: 25622 });
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
      bots.push(await connectFakePlayer({ port: server.port, name: `leaf${i}` }));
      const tr = await rcon.command(`tp leaf${i} ${o.x + 8} ${GY + 14} ${o.z + 8}`);
      if (!/^Teleported/.test(tr)) notes.push(`tp leaf${i}: ${tr.trim().slice(0, 120)}`);
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
      const r = await rcon.command(`data get storage mcliteref:leaf p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const vals = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 10)) : [];
      if (vals.length !== T) notes.push(`${plan.keys[j]}: read ${vals.length}/${T} samples (${r.trim().slice(0, 80)})`);
      (cases[id] || (cases[id] = {}))[what] = vals;
    }
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i], o = origin(i), fin = [];
      for (const c of sc.leaves) {
        const at = `${o.x + c[0]} ${GY + c[1]} ${o.z + c[2]}`;
        let v = 0;
        if (/passed/i.test(await rcon.command(`execute if block ${at} minecraft:${LEAF}`))) {
          for (let k = 1; k <= 7; k++) if (/passed/i.test(await rcon.command(`execute if block ${at} minecraft:${LEAF}[distance=${k}]`))) { v = k; break; }
          if (!v) notes.push(`${sc.id} ${at}: a leaf with no readable distance`);
        }
        fin.push(v);
      }
      cases[sc.id].final = fin;
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'leaf-decay', version: '1.18.2', speed: SPEED, cut: CUT, T,
    clock: 'per tick k: (k==1 place) (k==CUT cut logs) -> sample n,d7 -> one world tick; final DISTANCE per leaf cell after T (0 = gone)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'leaf-decay.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runleaf: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
