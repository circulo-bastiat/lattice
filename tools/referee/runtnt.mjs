#!/usr/bin/env node
// runtnt.mjs — the referee's TNT runner (infra I6, 25 Sept 2026). Scenarios: tntscen.mjs.
//
//   node tools/referee/runtnt.mjs              # part A (7 blast cases x N) + part B (40 fuse stations x 120 ticks), ~5 min
//   node tools/referee/runtnt.mjs --only A|B   # one part; merges into an existing golden
//
// Part A: per trial -- rebuild the scene with /fill, summon one TNT {Fuse:1s,NoGravity:1b} (TntEntity.tick: the first
// tick takes the fuse to 0, discards the entity and explodes at getBodyY(0.0625), power 4 -- .decomp entity/TntEntity.java),
// wait a bounded 250 ms (5 ticks) on the server WE started, then ONE datapack function writes the 1331 read-box air bits to
// storage and ONE sums the dropped items' Count (not polling, D-436). Part B: the redstone pack's clock -- a
// `#minecraft:tick` function places every station's redstone block at tick 1 and appends each probe per tick.
// Own port 25621 and work dir (MCLITE_TNT_WORKDIR, default ~/.mclite-referee-tnt) so it can run beside another runner;
// golden -> <referee dir>/golden/tnt.json (D-6: generated, never committed).
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { R, N, BLAST, S, T, PITCH, STATION, blastScene, readCells } from './tntscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const O = [8, -50, 8];                       // part A: the TNT's own cell
const BY = -60;                              // part B: stations stand on the flat world's grass (y -61)
const BX = (k) => 200 + k * PITCH;
const argv = process.argv.slice(2);
// --creeper (infra I6, 25 Sept): part A only, the blast from a creeper summoned {Fuse:0s,ignited:1b,NoAI:1b} in the same cell
// (CreeperEntity.tick: currentFuseTime >= fuseTime -> explode(): createExplosion(getX(),getY(),getZ(), 3, DESTROY) -- feet
// height, power 3, and DESTROY so a broken block survives 1 in 3) -> golden creeper-blast.json, read by creeperrefcheck.mjs.
const CREEPER = argv.includes('--creeper');
const only = CREEPER ? 'A' : (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null);
const GOLDEN_NAME = CREEPER ? 'creeper-blast.json' : 'tnt.json';

async function main() {
  const workDir = process.env.MCLITE_TNT_WORKDIR || join(homedir(), '.mclite-referee-tnt');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitetnt');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitetnt', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee tnt' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitetnt:gate'] }));
  const H = R + 1;
  const [ox, oy, oz] = O;
  // --- part A functions
  const cells = readCells();
  writeFileSync(join(fdir, 'read.mcfunction'), [`data modify storage mclitetnt:r v set value [${cells.map(() => '0').join(',')}]`,
    ...cells.map(([x, y, z], i) => `execute store result storage mclitetnt:r v[${i}] int 1 if block ${ox + x} ${oy + y} ${oz + z} minecraft:air`)].join('\n') + '\n');
  writeFileSync(join(fdir, 'item.mcfunction'), ['execute store result score #a mclt run data get entity @s Item.Count', 'scoreboard players operation #s mclt += #a mclt'].join('\n') + '\n');
  writeFileSync(join(fdir, 'items.mcfunction'), ['scoreboard players set #s mclt 0',
    `execute as @e[type=item,x=${ox - H - 3},y=${oy - H - 3},z=${oz - H - 3},dx=${2 * H + 6},dy=${2 * H + 6},dz=${2 * H + 6}] run function mclitetnt:item`].join('\n') + '\n');
  BLAST.forEach((c, k) => {
    const lines = [`fill ${ox - H - 1} ${oy - H - 1} ${oz - H - 1} ${ox + H + 1} ${oy + H + 1} ${oz + H + 1} minecraft:air`];
    if (c.kind === 'crater') lines.push(`fill ${ox - H} ${oy - H} ${oz - H} ${ox + H} ${oy - 1} ${oz + H} minecraft:${c.block}`);
    else {
      lines.push(`fill ${ox - H} ${oy - H} ${oz - H} ${ox + H} ${oy + H} ${oz + H} minecraft:${c.block}`);
      lines.push(`setblock ${ox} ${oy} ${oz} minecraft:${c.kind === 'water' ? 'water' : 'air'}`);
    }
    // sanity: the scene is exactly blastScene()
    const want = blastScene(c).length, vol = c.kind === 'crater' ? (2 * H + 1) ** 2 * H : (2 * H + 1) ** 3 - (c.kind === 'water' ? 0 : 1);
    if (want !== vol) throw new Error(`${c.id}: scene size ${want} != fill volume ${vol}`);
    writeFileSync(join(fdir, `scene${k}.mcfunction`), lines.join('\n') + '\n');
  });
  // --- part B functions: gate -> step (tick k: events, then one append per probe)
  const probes = [];
  for (let k = 0; k < S; k++) {
    const x = BX(k);
    probes.push({ key: `s${k}.n`, cmd: `if entity @e[type=tnt,x=${x - 4},y=${BY - 3},z=-4,dx=11,dy=12,dz=8]` });
    probes.push({ key: `s${k}.b2`, cmd: `if block ${x + STATION.second[0]} ${BY} ${STATION.second[2]} minecraft:tnt` });
  }
  probes.push({ key: 's0.y', cmd: `run data get entity @e[type=tnt,x=${BX(0) + 0.5},y=${BY},z=0.5,distance=..3,limit=1,sort=nearest] Pos[1] 1000` });
  const setupB = [`fill ${BX(0) - 8} ${BY} -8 ${BX(S - 1) + 8} ${BY + 10} 8 minecraft:air`];
  for (let k = 0; k < S; k++) {
    const x = BX(k);
    setupB.push(`setblock ${x} ${BY} 0 minecraft:tnt`, `setblock ${x + STATION.second[0]} ${BY} ${STATION.second[2]} minecraft:tnt`);
  }
  const ev1 = Array.from({ length: S }, (_, k) => `setblock ${BX(k) + STATION.power[0]} ${BY} ${STATION.power[2]} minecraft:redstone_block`);
  writeFileSync(join(fdir, 'gate.mcfunction'), `execute if score #run mclt matches 1 if score #t mclt matches ..${T - 1} run function mclitetnt:step\n`);
  writeFileSync(join(fdir, 'step.mcfunction'), ['scoreboard players add #t mclt 1',
    ...ev1.map((c) => `execute if score #t mclt matches 1 run ${c}`),
    ...probes.flatMap((p, j) => [`data modify storage mclitetnt:f p${j} append value 0`, `execute store result storage mclitetnt:f p${j}[-1] int 1 ${p.cmd}`])].join('\n') + '\n');

  const server = await startServer({ workDir, port: 25621, rconPort: 26621, xmx: '1536M' });
  const t0 = Date.now();
  const refGolden = join(refereeWorkDir(), 'golden', GOLDEN_NAME);
  const golden = CREEPER ? { pack: 'creeper-blast', version: '1.18.2', blast: {}, fuse: {} } : (only && existsSync(refGolden)) ? JSON.parse(readFileSync(refGolden, 'utf8')) : { pack: 'tnt', version: '1.18.2', blast: {}, fuse: {} };
  const notes = [];
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false', 'weather clear',
      'gamerule doTileDrops true', 'gamerule doEntityDrops true', 'scoreboard objectives add mclt dummy', 'scoreboard players set #run mclt 0',
      'scoreboard players set #t mclt 0', 'forceload add -16 -16 31 31', `forceload add ${BX(0) - 16} -16 ${BX(S - 1) + 16} 16`]) {
      const r = await C(c);
      if (/Unknown|Invalid|Incorrect|expected|error/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    }
    if (/Unknown function/i.test(await C('function mclitetnt:items'))) throw new Error('datapack not loaded');
    if (only !== 'B') {
      golden.blast = {};
      for (let k = 0; k < BLAST.length; k++) {
        const c = BLAST[k];
        const air = new Array(readCells().length).fill(0), destroyed = [], items = [];
        for (let t = 0; t < N; t++) {
          await C('kill @e[type=!player]');
          await C(`function mclitetnt:scene${k}`);
          const s = await C(CREEPER ? `summon minecraft:creeper ${ox + 0.5} ${oy} ${oz + 0.5} {Fuse:0s,ignited:1b,NoAI:1b,NoGravity:1b}`
            : `summon minecraft:tnt ${ox + 0.5} ${oy} ${oz + 0.5} {Fuse:1s,NoGravity:1b,Motion:[0.0d,0.0d,0.0d]}`);
          if (!/Summoned/.test(s)) { notes.push(`${c.id}: summon failed ${s.trim().slice(0, 100)}`); break; }
          await sleep(250);
          await C('function mclitetnt:read');
          const r = await C('data get storage mclitetnt:r v');
          const m = /\[(.*)\]/s.exec(r);
          const v = m ? m[1].split(',').map((q) => parseInt(q.trim(), 10)) : [];
          if (v.length !== air.length) { notes.push(`${c.id}: unreadable read box (${r.trim().slice(0, 80)})`); continue; }
          await C('function mclitetnt:items');
          const it = /has (\d+) /.exec(await C('scoreboard players get #s mclt'));
          v.forEach((b, i) => { air[i] += b; });
          destroyed.push(v.reduce((a, b) => a + b, 0));
          items.push(it ? +it[1] : 0);
        }
        golden.blast[c.id] = { trials: destroyed.length, air, destroyed, items };
        const mean = (a) => (a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)).toFixed(1);
        console.log(`  ${c.id.padEnd(16)} ${destroyed.length} trials, air cells mean ${mean(destroyed)}, items mean ${mean(items)}`);
      }
      await C('kill @e[type=!player]');
      await C(`fill ${ox - H - 1} ${oy - H - 1} ${oz - H - 1} ${ox + H + 1} ${oy + H + 1} ${oz + H + 1} minecraft:air`);
    }
    if (only !== 'A') {
      for (const c of setupB) { const r = await C(c); if (/Unknown|Invalid|Incorrect|expected|error|Could not/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 100)}`); }
      for (let j = 0; j < probes.length; j++) await C(`data modify storage mclitetnt:f p${j} set value []`);
      await C('scoreboard players set #t mclt 0');
      await C('scoreboard players set #run mclt 1');
      await sleep(T * 50 + 2000);           // ONE bounded wait for the T-tick run we started, then one read of the counter
      const tr = await C('scoreboard players get #t mclt');
      if (!new RegExp(`has ${T} `).test(tr)) throw new Error('tick function did not reach T: ' + tr);
      await C('scoreboard players set #run mclt 0');
      golden.fuse = { S, T, probes: {} };
      for (let j = 0; j < probes.length; j++) {
        const r = await C(`data get storage mclitetnt:f p${j}`);
        const m = /\[(.*)\]/s.exec(r);
        const vals = m ? m[1].split(',').map((q) => q.trim()).filter(Boolean).map((q) => parseInt(q, 10)) : [];
        if (vals.length !== T) notes.push(`${probes[j].key}: ${vals.length}/${T} samples`);
        golden.fuse.probes[probes[j].key] = vals;
      }
      const d = [];
      for (let k = 0; k < S; k++) {
        const n = golden.fuse.probes[`s${k}.n`], b2 = golden.fuse.probes[`s${k}.b2`];
        const t1 = b2.indexOf(0), t2 = n.lastIndexOf(1) + 1;
        d.push(t2 - t1);
      }
      console.log(`  fuse: first blast at sample ${golden.fuse.probes['s0.b2'].indexOf(0)}, chain delays ${d.join(',')}`);
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  Object.assign(golden, { R, clock: 'A: /fill scene, summon Fuse:1 NoGravity, +250 ms, read. B: tick function (events for k, then samples), before the worlds tick',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), notes });
  mkdirSync(join(refereeWorkDir(), 'golden'), { recursive: true });
  writeFileSync(refGolden, JSON.stringify(golden) + '\n');
  console.log(`referee/runtnt: ${golden.seconds} s -> ${refGolden}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
