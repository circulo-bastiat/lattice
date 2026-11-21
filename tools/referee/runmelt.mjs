#!/usr/bin/env node
// runmelt.mjs — the referee's ICE / SNOW-LAYER MELT runner (infra I6, 25 Sept 2026). Scenarios + clock: meltscen.mjs.
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runmelt.mjs      # ~1.5 min, the real server
//
// 1. place everything (randomTickSpeed 0, midnight); 2. MEASURE the light at every probe with `location_check` light
// predicates (mcliteref:l0..l15) — inside a closed stone box the sky adds nothing, so this is the BLOCK light; outside it
// is max(block, the night sky) and is recorded as such; 3. noon + randomTickSpeed SPEED, a `#minecraft:tick` function
// samples each scenario's surviving-cell count every EVERY ticks; one fake player is parked above every scenario (random
// ticks need a real player watching the chunk — growbot.mjs); ONE bounded wait for our own run (D-436); 4. the final
// block at every cell (ice / snow / water / air / other) and the light re-measured at midnight.
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/melt.json
//   { speed, every, T, cases: { "<id>": { alive: [..T/EVERY], final: [...], light: {"x,dy,z": n}, lightAfter: {...}, floor } } }
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, serverPlan, origin, probes, SPEED, EVERY, GY, NIGHT, NOON } from './meltscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const plan = serverPlan();
  const T = plan.T;
  console.log(`referee/runmelt: ${SCENARIOS.length} scenarios, speed=${SPEED}, ${T} ticks`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteref', 'functions'), pdir = join(dp, 'data', 'mcliteref', 'predicates');
  mkdirSync(fdir, { recursive: true }); mkdirSync(pdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee melt' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mcliteref:gate'] }));
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclr matches 1 if score #t mclr matches ..${T - 1} run function mcliteref:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclr 1', ...plan.step].join('\n') + '\n');
  for (let n = 0; n <= 15; n++) writeFileSync(join(pdir, `l${n}.json`), JSON.stringify({ condition: 'minecraft:location_check', predicate: { light: { light: n } } }));

  const server = await startServer({ port: 25631, rconPort: 25632 });
  let rcon;
  const bots = [];
  const t0 = Date.now();
  const cases = {}, notes = [];
  const lightAt = async (x, y, z) => {
    for (let n = 15; n >= 0; n--) if (/passed/i.test(await rcon.command(`execute positioned ${x + 0.5} ${y + 0.5} ${z + 0.5} if predicate mcliteref:l${n}`))) return n;
    return -1;
  };
  const measure = async (key) => {
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i], o = origin(i), m = {};
      for (const [x, dy, z] of probes(sc)) m[`${x},${dy},${z}`] = await lightAt(o.x + x, GY + dy, o.z + z);
      (cases[sc.id] || (cases[sc.id] = {}))[key] = m;
      // the night-sky floor for this scenario: a probe with no source anywhere near (the box's own middle, far corner)
      if (key === 'light') cases[sc.id].floor = await lightAt(o.x + 13, GY + 3, o.z + 2);
    }
  };
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
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
      bots.push(await connectFakePlayer({ port: server.port, name: `melt${i}` }));
      const tr = await rcon.command(`tp melt${i} ${o.x + 8} ${GY + 14} ${o.z + 8}`);
      if (!/^Teleported/.test(tr)) notes.push(`tp melt${i}: ${tr.trim().slice(0, 120)}`);
    }
    await sleep(3000);                     // the light engine settles (a fixed wait on our own server, not a poll)
    await measure('light');
    await rcon.command(`time set ${NOON}`);
    await rcon.command(`gamerule randomTickSpeed ${SPEED}`);
    await rcon.command('scoreboard players set #run mclr 1');
    await sleep(T * 50 * 1.5 + 4000);      // the ONE bounded wait for our own run (D-436)
    const tr = await rcon.command('scoreboard players get #t mclr');
    if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
    await rcon.command('scoreboard players set #run mclr 0');
    await rcon.command('gamerule randomTickSpeed 0');
    const online = +((await rcon.command('list')).match(/There are (\d+)/) || [])[1];
    if (online !== SCENARIOS.length) notes.push(`only ${online}/${SCENARIOS.length} referee players online at the end`);
    for (let j = 0; j < plan.keys.length; j++) {
      const r = await rcon.command(`data get storage mcliteref:melt p${j}`);
      const m = /\[(.*)\]/.exec(r);
      const vals = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 10)) : [];
      if (vals.length !== Math.floor(T / EVERY)) notes.push(`${plan.keys[j]}: read ${vals.length}/${Math.floor(T / EVERY)} samples`);
      cases[plan.keys[j]].alive = vals;
    }
    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i], o = origin(i), fin = [];
      for (const [x, dy, z] of sc.cells) {
        const at = `${o.x + x} ${GY + dy} ${o.z + z}`;
        let v = 'other';
        for (const [name, pred] of [['ice', 'minecraft:ice'], ['snow', 'minecraft:snow'], ['water', 'minecraft:water'], ['air', 'minecraft:air']]) {
          if (/passed/i.test(await rcon.command(`execute if block ${at} ${pred}`))) { v = name; break; }
        }
        fin.push(v);
      }
      cases[sc.id].final = fin;
    }
    await rcon.command(`time set ${NIGHT}`);
    await sleep(1500);
    await measure('lightAfter');
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'melt', version: '1.18.2', speed: SPEED, every: EVERY, T,
    clock: 'placed + light measured at midnight (randomTickSpeed 0); then noon, per tick k: (k%EVERY==0 sample alive count) -> one world tick; final block per cell',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'melt.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runmelt: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}`);
  for (const sc of SCENARIOS) {
    const c = cases[sc.id];
    console.log(`  ${sc.id.padEnd(10)} floor ${c.floor} light ${sc.cells.map(([x, dy, z]) => c.light[`${x},${dy},${z}`]).join(' ')} | final ${c.final.join(' ')}`);
  }
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
