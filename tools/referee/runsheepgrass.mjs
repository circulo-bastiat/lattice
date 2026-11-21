#!/usr/bin/env node
// runsheepgrass.mjs — the referee's SHEEP EAT GRASS runner (infra W, 25 Sept 2026). Scenarios: sheepgrassscen.mjs.
//   node tools/referee/runsheepgrass.mjs
// No growbot needed — entity AI (the goal selector) ticks under a plain `/forceload`, the same fact
// runbreed.mjs's own MATE pens already rely on (docs/archive/REFEREE.md, FEEDING+BREEDING). Two PHASES, sequential on
// the one server: PHASE1 (mobGriefing true) builds every scenario in sheepgrassscen.PHASE1 at once, then PHASE2
// (mobGriefing false) builds sheepgrassscen.PHASE2. Each phase's ENTIRE setup (walls, floor, every sheep's own
// `/summon`) is ONE `/function` call against a datapack this runner writes (rungrowth.mjs's own technique) —
// hundreds of summons cost nothing over RCON when they are lines in a function file the server runs in a single
// tick, instead of one round trip each. Geometry is a single open 1-wide corridor per scenario (no per-sheep
// partition walls): the two things this pack measures — how many TAGGED sheep have Sheared:0b, and how many of
// the corridor's own floor cells have turned to dirt — are both AGGREGATE counts, so a sheep wandering a few
// blocks inside its own scenario's corridor changes nothing being measured (it cannot leave the corridor or
// reach another scenario's row). Per checkpoint: SUM(one) over @e[tag,nbt={Sheared:0b}] for the eaten count (the
// per-tag SUM trick runbreed.mjs's own FEED loop uses), and a `fill ... minecraft:glass replace minecraft:dirt`
// swap-read (rungrowth.mjs's technique) for the CONVERTIBLE scenarios' dirt count. At the end of PHASE1: SUM(Age)
// + n for `baby_grass_block`'s own EATEN sheep vs. all of `baby_control` — the fed-minus-control trick
// breedscen.mjs's FEED scenes use to cancel ordinary per-tick Age drift, isolating the +1200-tick growUp(60).
// Own port 25891 + work dir (MCLITE_SHEEPGRASS_WORKDIR, default ~/.mclite-referee-sheepgrass); golden ->
// <referee dir>/golden/sheep-grass.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { PHASE1, PHASE2, CHECKPOINTS, T, GY, FEET, WALL_H, CONVERTIBLE, rowGeometry } from './sheepgrassscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (r) => { const m = /(-?\d+)\s*$/.exec(String(r).trim()) || /has (-?\d+)/.exec(String(r)); return m ? +m[1] : NaN; };
const filled = (r) => { const m = /filled (\d+)/.exec(String(r)); return m ? +m[1] : 0; };

async function main() {
  const workDir = process.env.MCLITE_SHEEPGRASS_WORKDIR || join(homedir(), '.mclite-referee-sheepgrass');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  // the datapack must exist BEFORE the server's first boot generates `world/` (rungrowth.mjs's own ordering) —
  // added afterwards, the server never notices it without a `/reload`.
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteref');
  const fdir = join(dp, 'data', 'mcliteref', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee sheep-grass' } }));

  function scenarioLines(s) {
    const { z0, xMin, xMax, cellX } = rowGeometry(s);
    const lines = [];
    lines.push(`fill ${xMin} ${FEET} ${z0 - 1} ${xMax} ${FEET + WALL_H} ${z0 + 1} minecraft:air`);
    const groundBlock = s.ground === 'dirt' ? 'minecraft:dirt' : 'minecraft:grass_block';
    lines.push(`fill ${xMin} ${GY} ${z0} ${xMax} ${GY} ${z0} ${groundBlock}`);
    lines.push(`fill ${xMin} ${FEET} ${z0 - 1} ${xMax} ${FEET + WALL_H - 1} ${z0 - 1} minecraft:stone`);
    lines.push(`fill ${xMin} ${FEET} ${z0 + 1} ${xMax} ${FEET + WALL_H - 1} ${z0 + 1} minecraft:stone`);
    lines.push(`fill ${xMin - 1} ${FEET} ${z0 - 1} ${xMin - 1} ${FEET + WALL_H - 1} ${z0 + 1} minecraft:stone`);
    lines.push(`fill ${xMax + 1} ${FEET} ${z0 - 1} ${xMax + 1} ${FEET + WALL_H - 1} ${z0 + 1} minecraft:stone`);
    if (s.ground === 'grass_plant') {
      for (let k = 0; k < s.n; k++) lines.push(`setblock ${cellX(k)} ${FEET} ${z0} minecraft:grass`);
    }
    for (let k = 0; k < s.n; k++) {
      const x = cellX(k) + 0.5;
      lines.push(`summon minecraft:sheep ${x} ${FEET} ${z0 + 0.5} {PersistenceRequired:1b,Silent:1b,Sheared:1b,Age:${s.age},Tags:["${s.id}"]}`);
    }
    lines.push(`scoreboard players set @e[tag=${s.id}] one 1`);
    return lines;
  }
  writeFileSync(join(fdir, 'setup1.mcfunction'), PHASE1.flatMap(scenarioLines).join('\n') + '\n');
  writeFileSync(join(fdir, 'setup2.mcfunction'), PHASE2.flatMap(scenarioLines).join('\n') + '\n');

  const server = await startServer({ workDir, port: 25891, rconPort: 26891, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty easy', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'gamerule mobGriefing true',
      'scoreboard objectives add one dummy', 'scoreboard objectives add age dummy', 'scoreboard objectives add r dummy']) {
      const r = await C(c);
      if (/Unknown|Incorrect|expected/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    // ⚠ one `/forceload add` PER SCENARIO, never one giant region: vanilla caps a single `/forceload add` at 256
    // chunks, and a first run of this pack (`-8 -8 2000 40`, a lazily generous single region) silently blew that
    // cap ("Too many chunks in the specified area") — the command just fails outright, nothing loads, every
    // `fill`/`summon` past the world's own default spawn-chunk radius then silently no-ops ("not loaded"), and
    // the resulting golden was pure noise (a dirt-floor "never eats" control scenario reading back a nonzero
    // eaten count, because most of its own row was never actually built and sheep stood on default untouched
    // grass_block instead). Each scenario's own row is small (a few dozen chunks at most), comfortably under
    // the cap on its own.
    for (const s of PHASE1.concat(PHASE2)) {
      const { z0, xMin, xMax } = rowGeometry(s);
      const r = await C(`forceload add ${xMin - 2} ${z0 - 2} ${xMax + 2} ${z0 + 2}`);
      if (/Too many chunks|Unknown|Incorrect|expected/i.test(r)) notes.push(`forceload ${s.id}: ${r.trim().slice(0, 160)}`);
    }
    const fnList = await C('function mcliteref:setup1');
    if (/Unknown function/i.test(fnList)) throw new Error('sheep-grass datapack not loaded: ' + fnList);

    async function readEaten(s) {
      await C('scoreboard players set #r r 0');
      await C(`scoreboard players operation #r r += @e[tag=${s.id},nbt={Sheared:0b}] one`);
      return num(await C('scoreboard players get #r r'));
    }
    async function readDirt(s) {
      const { z0, xMin, xMax } = rowGeometry(s);
      const n1 = filled(await C(`fill ${xMin} ${GY} ${z0} ${xMax} ${GY} ${z0} minecraft:glass replace minecraft:dirt`));
      await C(`fill ${xMin} ${GY} ${z0} ${xMax} ${GY} ${z0} minecraft:dirt replace minecraft:glass`);
      return n1;
    }
    async function runPhase(scenarios) {
      for (const s of scenarios) cases[s.id] = { n: s.n, age: s.age, ground: s.ground, checkpoints: {} };
      let elapsed = 0;
      for (const ck of CHECKPOINTS) {
        await sleep((ck - elapsed) * 50);
        elapsed = ck;
        for (const s of scenarios) {
          const eaten = await readEaten(s);
          const rec = { eaten };
          if (CONVERTIBLE.has(s.id)) rec.dirt = await readDirt(s);
          cases[s.id].checkpoints[ck] = rec;
        }
      }
      return elapsed;
    }

    const t1 = await runPhase(PHASE1);
    // one exact readout for the baby growUp boost: tag the EATEN baby_grass_block sheep, then SUM(Age) + n for
    // that tag vs. every baby_control sheep (dirt floor, cannot have eaten) at the SAME elapsed tick.
    await C('tag @e[tag=baby_grass_block,nbt={Sheared:0b}] add ate');
    async function ageSum(sel) {
      await C(`scoreboard players set #r age 0`);
      await C(`execute as @e[${sel}] store result score @s age run data get entity @s Age`);
      await C(`scoreboard players operation #r age += @e[${sel}] age`);
      await C('scoreboard players set #r r 0');
      await C(`scoreboard players operation #r r += @e[${sel}] one`);
      return { ageSum: num(await C('scoreboard players get #r age')), n: num(await C('scoreboard players get #r r')) };
    }
    const eatenAge = await ageSum('tag=ate');
    const controlAge = await ageSum('tag=baby_control');
    cases.babyGrowth = { atTick: t1, eaten: eatenAge, control: controlAge };

    await C('gamerule mobGriefing false');
    const fnList2 = await C('function mcliteref:setup2');
    if (/Unknown function/i.test(fnList2)) throw new Error('sheep-grass datapack (phase2) not loaded: ' + fnList2);
    await runPhase(PHASE2);
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = {
    pack: 'sheep-grass', version: '1.18.2', checkpoints: CHECKPOINTS, T,
    clock: 'a single open 1-wide corridor per scenario, N sheep, AI on, no player needed (forceload); the whole ' +
      'setup (walls/floor/every summon) is one /function call; per checkpoint: SUM(one) over ' +
      '@e[tag,nbt={Sheared:0b}] for the eaten count, a fill/replace/restore swap-read for the grass_block->dirt ' +
      'count on CONVERTIBLE scenarios',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'sheep-grass.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runsheepgrass: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${out}${notes.length ? '\n  notes: ' + notes.slice(0, 5).join(' | ') : ''}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
