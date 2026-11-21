#!/usr/bin/env node
// runspread.mjs — the referee's GRASS SPREAD / COVER / STEM runner (infra I6, 25 Sept 2026). Scenarios: spreadscen.mjs.
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runspread.mjs      # ~8 min, the real server
//
// Per phase (A midnight, B noon): build that phase's scenes (randomTickSpeed 0), park one fake player above each (random
// ticks need a player watching the chunk — growbot.mjs), MEASURE the block light at every probe of the closed boxes with
// `location_check` light predicates (binary search over mcliteref:ge0..ge15), then randomTickSpeed SPEED for >= T ticks —
// ONE bounded wait on our own server (D-436), the elapsed game time read back and recorded — then the final block at every
// cell. Golden (GENERATED, never committed -- D-6): <referee dir>/golden/spread.json
//   { speed, T, phases: { A: { time, ticks, floor }, B: {...} }, cases: { "<id>": { final: [[name, props]...], light: {"x,dy,z": n}, floor } } }
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCENARIOS, origin, probes, finalProbes, buildCommands, SPEED, T, GY, TIME, EXTENT } from './spreadscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --phase A|B: run ONE phase and merge its cases into the existing golden (the other phase's cases kept) — half the time.
const ONLY = (() => { const i = process.argv.indexOf('--phase'); return i >= 0 ? process.argv[i + 1] : null; })();
const RUN_PHASES = ONLY ? [ONLY] : ['A', 'B'];

async function main() {
  console.log(`referee/runspread: ${SCENARIOS.length} scenarios, speed=${SPEED}, ${T} ticks per phase`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  const pdir = join(dp, 'data', 'mcliteref', 'predicates');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee spread' } }));
  for (let n = 0; n <= 15; n++) writeFileSync(join(pdir, `ge${n}.json`), JSON.stringify({ condition: 'minecraft:location_check', predicate: { light: { light: { min: n } } } }));

  const server = await startServer({ port: 25821, rconPort: 25822 });
  let rcon;
  const bots = [];
  const t0 = Date.now();
  const cases = {}, notes = [], phases = {};
  const cmd = async (c) => {
    const r = await rcon.command(c);
    if (/Unknown|Invalid|Incorrect|Could not|expected|error|Too many|not loaded/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    return r;
  };
  const ge = async (x, y, z, n) => /passed/i.test(await rcon.command(`execute positioned ${x + 0.5} ${y + 0.5} ${z + 0.5} if predicate mcliteref:ge${n}`));
  const lightAt = async (x, y, z) => { let lo = 0, hi = 15; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (await ge(x, y, z, m)) lo = m; else hi = m - 1; } return lo; };
  const gametime = async () => +((await rcon.command('time query gametime')).match(/(\d+)/) || [])[1];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    if (!/passed|failed/i.test(await rcon.command('execute if predicate mcliteref:ge0'))) throw new Error('datapack predicates not loaded');
    for (const c of ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false', 'gamerule randomTickSpeed 0',
      'gamerule doFireTick false', 'gamerule doMobSpawning false', 'weather clear 1000000']) await cmd(c);
    await cmd(`forceload add -16 -16 ${EXTENT + 16} ${EXTENT + 16}`);
    for (const P of RUN_PHASES) {
      const ids = SCENARIOS.map((sc, i) => i).filter((i) => SCENARIOS[i].phase === P);
      await cmd(`time set ${TIME[P]}`);
      for (const i of ids) for (const c of buildCommands(i)) await cmd(c);
      for (const i of ids) {
        const o = origin(i), name = `spr${i}`;
        bots.push(await connectFakePlayer({ port: server.port, name }));
        const tr = await rcon.command(`tp ${name} ${o.x + 8} ${GY + 14} ${o.z + 8}`);
        if (!/^Teleported/.test(tr)) notes.push(`tp ${name}: ${tr.trim().slice(0, 120)}`);
      }
      await sleep(3000);                     // the light engine settles (a fixed wait on our own server, not a poll)
      for (const i of ids) {
        const sc = SCENARIOS[i], o = origin(i), m = {};
        for (const [x, dy, z] of probes(sc)) m[`${x},${dy},${z}`] = await lightAt(o.x + x, GY + dy, o.z + z);
        // the sky floor: the open air 3 above the scene's middle (in a box: its own empty corner)
        const floor = sc.box ? await lightAt(o.x + 13, GY + 3, o.z + 2) : await lightAt(o.x + 8, GY + 3, o.z + 2);
        cases[sc.id] = { light: m, floor };
      }
      const g0 = await gametime();
      await rcon.command(`gamerule randomTickSpeed ${SPEED}`);
      await sleep(T * 50 * 1.5 + 3000);      // the ONE bounded wait for this phase (D-436)
      await rcon.command('gamerule randomTickSpeed 0');
      const ticks = (await gametime()) - g0;
      phases[P] = { time: TIME[P], ticks, floor: cases[SCENARIOS[ids.find((i) => !SCENARIOS[i].box)].id].floor };
      if (!(ticks >= T)) notes.push(`phase ${P}: only ${ticks}/${T} ticks elapsed`);
      for (const i of ids) {
        const sc = SCENARIOS[i], o = origin(i), fin = [];
        for (const [x, dy, z] of sc.cells) {
          let v = ['other', {}];
          for (const [label, pred] of finalProbes(sc)) if (/passed/i.test(await rcon.command(`execute if block ${o.x + x} ${GY + dy} ${o.z + z} ${pred}`))) { v = label; break; }
          fin.push(v);
        }
        cases[sc.id].final = fin;
      }
    }
    const online = +((await rcon.command('list')).match(/There are (\d+)/) || [])[1];
    if (online !== SCENARIOS.filter((sc) => RUN_PHASES.includes(sc.phase)).length) notes.push(`only ${online}/${SCENARIOS.length} referee players online at the end`);
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'spread', version: '1.18.2', speed: SPEED, T, phases,
    clock: 'per phase (A midnight, B noon): build, bots, light measured (randomTickSpeed 0); randomTickSpeed SPEED for >= T ticks; final block per cell',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'spread.json');
  if (ONLY) {                                  // merge: keep the other phase from the golden already there
    if (!existsSync(out)) throw new Error('--phase needs an existing spread.json to merge into');
    const old = JSON.parse(readFileSync(out, 'utf8'));
    for (const sc of SCENARIOS) if (sc.phase !== ONLY && old.cases[sc.id]) golden.cases[sc.id] = old.cases[sc.id];
    for (const P of Object.keys(old.phases)) if (P !== ONLY) golden.phases[P] = old.phases[P];
    golden.notes = [...(old.notes || []), ...golden.notes];
    golden.merged = `phase ${ONLY} regenerated ${golden.generatedAt}; the other phase from ${old.generatedAt}`;
  }
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runspread: ${Object.keys(cases).length} scenarios in ${golden.seconds} s -> ${out}  phases ${JSON.stringify(phases)}`);
  for (const sc of SCENARIOS) {
    const c = golden.cases[sc.id];
    if (!c) continue;
    console.log(`  ${sc.id.padEnd(12)} floor ${String(c.floor).padStart(2)} | final ${c.final.map(([n, p]) => n + (p.age !== undefined ? p.age : '')).join(' ')}`);
  }
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
