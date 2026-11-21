#!/usr/bin/env node
// runenderman.mjs — the referee's ENDERMAN BEHAVIOUR runner (infra w-enderman) vs the real 1.18.2
// server. Zones/ticks: endermanscen.mjs. No player connects — every pen sits on a forceloaded pad
// (same trick runitems.mjs/runfloor.mjs already use). One continuous timeline, ALL checkpoints
// scheduled server-side (`schedule function ... <N>t`), read back with exactly one RCON round
// trip at the very end — same "server clock, not RCON polling" principle runitems.mjs's own
// header explains (a per-checkpoint RCON read of a distribution this thin would itself perturb
// the timing).
//
//   node tools/referee/runenderman.mjs        (~3 min)
//
// Own port 25881 / rcon 26881, work dir $MCLITE_ENDERMAN_WORKDIR or ~/.mclite-referee-enderman;
// golden -> golden/enderman.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';
import {
  FLOOR_Y, G_LANES, G_CHECK, PU_START, PU_CHECKS, P_LANES, PL_CHECKS, PL_LANES,
  WT_CHECKS, WT_LANES, AR_CHECKS, AR_LANES, MAX_X, MAX_Z,
} from './endermanscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const workDir = process.env.MCLITE_ENDERMAN_WORKDIR || join(homedir(), '.mclite-referee-enderman');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteendr');
  const fdir = join(dp, 'data', 'endr', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee enderman' } }));

  // ── one sealed pen per lane: 3x3 interior, 3 tall, stone shell + roof, floor material per zone
  const arena = [];
  const pen = (x, z, floorBlock) => {
    arena.push(`fill ${x - 2} ${FLOOR_Y - 1} ${z - 2} ${x + 2} ${FLOOR_Y + 4} ${z + 2} minecraft:stone`);   // shell+base+roof
    arena.push(`fill ${x - 1} ${FLOOR_Y} ${z - 1} ${x + 1} ${FLOOR_Y} ${z + 1} minecraft:${floorBlock}`);    // whole 3x3 floor
    arena.push(`fill ${x - 1} ${FLOOR_Y + 1} ${z - 1} ${x + 1} ${FLOOR_Y + 3} ${z + 1} minecraft:air`);      // 3x3x3 interior
  };
  // ⚠ PickUpBlockGoal's own target range (.decomp:449-475, 07zg_enderman.js's own
  // Enderman.PickUpBlockGoal) is `by = floor(e.y + rnd()*3)` -- e.Y..e.Y+2 inclusive, NEVER e.Y-1.
  // A block directly UNDERFOOT (the walking surface, one cell below e.y by construction of
  // "standing on it") is therefore never in reach — only a holdable block sitting AT or ABOVE the
  // enderman's own foot level is. So a "floored with dirt" pickup pen is a 1-block-deep PIT (stone
  // support, air) at the spawn column, ringed by dirt occupying THAT SAME y-cell (e.y) in the
  // surrounding 8 of the inner 3x3 — reachable, and the one true "vanilla fact measured" shape a
  // naive "dirt directly underfoot" pen (0% pickup ever, on server AND engine alike) would hide.
  const pickupPen = (x, z) => {
    arena.push(`fill ${x - 2} ${FLOOR_Y - 1} ${z - 2} ${x + 2} ${FLOOR_Y + 4} ${z + 2} minecraft:stone`);
    arena.push(`fill ${x - 1} ${FLOOR_Y + 1} ${z - 1} ${x + 1} ${FLOOR_Y + 1} ${z + 1} minecraft:dirt`);
    arena.push(`fill ${x - 1} ${FLOOR_Y + 2} ${z - 1} ${x + 1} ${FLOOR_Y + 3} ${z + 1} minecraft:air`);
    arena.push(`setblock ${x} ${FLOOR_Y + 1} ${z} minecraft:air`);   // the pit: spawn column, entity's own cell
  };
  for (const l of G_LANES) pickupPen(l.x, l.z);
  for (const l of P_LANES) pickupPen(l.x, l.z);
  for (const l of PL_LANES) pen(l.x, l.z, 'stone');   // NOT enderman_holdable -- see endermanscen.mjs header
  for (const l of AR_LANES) pen(l.x, l.z, 'stone');
  // water zone: same sealed shell, but the WHOLE interior is water (not just the floor) —
  // Enderman.applyWaterDamage only cares about `e.inWater`, so full submersion is the point.
  for (const l of WT_LANES) {
    pen(l.x, l.z, 'stone');
    arena.push(`fill ${l.x - 1} ${FLOOR_Y} ${l.z - 1} ${l.x + 1} ${FLOOR_Y + 3} ${l.z + 1} minecraft:water`);
  }
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');

  // ── G-zone summon (t=0): persistent endermen, griefing OFF already set before this runs
  const gSummon = G_LANES.map((l) => `summon minecraft:enderman ${l.x + 0.5} ${FLOOR_Y + 1} ${l.z + 0.5} {PersistenceRequired:1b,NoAI:0b,Tags:["gr","gr${l.id}"]}`);
  writeFileSync(join(fdir, 'gsummon.mcfunction'), gSummon.join('\n') + '\n');

  // ── the four griefing-ON zones, summoned together at PU_START
  const mainSummon = [];
  for (const l of P_LANES) mainSummon.push(`summon minecraft:enderman ${l.x + 0.5} ${FLOOR_Y + 1} ${l.z + 0.5} {PersistenceRequired:1b,NoAI:0b,Tags:["pu","pu${l.id}"]}`);
  for (const l of PL_LANES) mainSummon.push(`summon minecraft:enderman ${l.x + 0.5} ${FLOOR_Y + 1} ${l.z + 0.5} {PersistenceRequired:1b,NoAI:0b,carriedBlockState:{Name:"minecraft:dirt"},Tags:["pl","pl${l.id}"]}`);
  for (const l of WT_LANES) mainSummon.push(`summon minecraft:enderman ${l.x + 0.5} ${FLOOR_Y + 1} ${l.z + 0.5} {PersistenceRequired:1b,NoAI:0b,Tags:["wt","wt${l.id}"]}`);
  for (const l of AR_LANES) {
    mainSummon.push(`summon minecraft:enderman ${l.x + 0.5} ${FLOOR_Y + 1} ${l.z + 0.5} {PersistenceRequired:1b,NoAI:0b,Health:40.0f,Tags:["ar","ar${l.id}"]}`);
    // arrow spawned 1.5 blocks off in -Z, aimed straight at the enderman's centre, fast enough
    // to arrive within 1 tick — every AR_CHECKS tick is well past impact.
    mainSummon.push(`summon minecraft:arrow ${l.x + 0.5} ${FLOOR_Y + 1.5} ${l.z - 1.0} {Motion:[0.0d,0.0d,3.0d],pickup:0b,Tags:["ara${l.id}"]}`);
  }
  writeFileSync(join(fdir, 'mainsummon.mcfunction'), mainSummon.join('\n') + '\n');

  // ── checkpoints. skey sanitises ids used as storage-path segments (runitems.mjs's own trick —
  // NBT paths split on '.', never on a plain integer id here, but kept for consistency/safety).
  const gCp = [`execute store result storage endr:r g int 1 run execute if entity @e[tag=gr,nbt={carriedBlockState:{}}]`,
    'gamerule mobGriefing true', 'function endr:mainsummon'];
  writeFileSync(join(fdir, 'gcheck.mcfunction'), gCp.join('\n') + '\n');

  for (const cp of PU_CHECKS) {
    writeFileSync(join(fdir, `pu${cp}.mcfunction`),
      `execute store result storage endr:r p.t${cp} int 1 run execute if entity @e[tag=pu,nbt={carriedBlockState:{}}]\n`);
  }
  for (const cp of PL_CHECKS) {
    // "still carrying" count; PL_N minus this = "has placed at least once by this tick"
    writeFileSync(join(fdir, `pl${cp}.mcfunction`),
      `execute store result storage endr:r pl.t${cp} int 1 run execute if entity @e[tag=pl,nbt={carriedBlockState:{}}]\n`);
  }
  for (const cp of WT_CHECKS) {
    const w = [];
    for (const l of WT_LANES) {
      w.push(`execute store result storage endr:r wt.l${l.id}.t${cp}.h int 1 if entity @e[tag=wt${l.id}] run data get entity @e[tag=wt${l.id},limit=1] Health 100`);
      w.push(`execute store result storage endr:r wt.l${l.id}.t${cp}.x int 1000 if entity @e[tag=wt${l.id}] run data get entity @e[tag=wt${l.id},limit=1] Pos[0]`);
      w.push(`execute store result storage endr:r wt.l${l.id}.t${cp}.z int 1000 if entity @e[tag=wt${l.id}] run data get entity @e[tag=wt${l.id},limit=1] Pos[2]`);
    }
    writeFileSync(join(fdir, `wt${cp}.mcfunction`), w.join('\n') + '\n');
  }
  for (const cp of AR_CHECKS) {
    const w = [];
    for (const l of AR_LANES) {
      w.push(`execute store result storage endr:r ar.l${l.id}.t${cp}.h int 1 if entity @e[tag=ar${l.id}] run data get entity @e[tag=ar${l.id},limit=1] Health 100`);
      w.push(`execute store result storage endr:r ar.l${l.id}.t${cp}.x int 1000 if entity @e[tag=ar${l.id}] run data get entity @e[tag=ar${l.id},limit=1] Pos[0]`);
      w.push(`execute store result storage endr:r ar.l${l.id}.t${cp}.z int 1000 if entity @e[tag=ar${l.id}] run data get entity @e[tag=ar${l.id},limit=1] Pos[2]`);
    }
    writeFileSync(join(fdir, `ar${cp}.mcfunction`), w.join('\n') + '\n');
  }

  // schedule everything off the world-start tick clock — one summon function scheduled `Nt`
  // fires at the START of tick N i.e. after N-1 ticks of that thing's own AI have already run
  // (runitems.mjs's own "OFF BY ONE, CONFIRMED EMPIRICALLY" header applies identically here).
  const schedules = [`schedule function endr:gcheck ${G_CHECK + 1}t replace`];
  for (const cp of PU_CHECKS) schedules.push(`schedule function endr:pu${cp} ${PU_START + cp + 1}t replace`);
  for (const cp of PL_CHECKS) schedules.push(`schedule function endr:pl${cp} ${PU_START + cp + 1}t replace`);
  for (const cp of WT_CHECKS) schedules.push(`schedule function endr:wt${cp} ${PU_START + cp + 1}t replace`);
  for (const cp of AR_CHECKS) schedules.push(`schedule function endr:ar${cp} ${PU_START + cp + 1}t replace`);
  writeFileSync(join(fdir, 'boot.mcfunction'), schedules.join('\n') + '\n');

  const server = await startServer({ workDir, port: 25881, rconPort: 26881, xmx: '1280M' });
  const t0 = Date.now();
  const notes = [];
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword, timeoutMs: 120000 }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c, 120000);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule mobGriefing false',
      `forceload add -16 -16 ${MAX_X + 16} ${MAX_Z + 16}`, 'datapack enable "file/mcliteendr"'])
      await C(c);
    await C('function endr:arena');
    await sleep(2000);   // let every pen's chunk settle before anything is summoned into it
    await C('data modify storage endr:r set value {}');
    await C('function endr:gsummon');
    await C('function endr:boot');

    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const g0 = await gametime();
    const lastTick = PU_START + Math.max(...PU_CHECKS, ...PL_CHECKS, ...WT_CHECKS, ...AR_CHECKS) + 2;
    await sleep(lastTick * 50 + 2000);
    for (let a = 1; ; a++) { const gt = await gametime(); if (gt >= g0 + lastTick) break; if (a >= 40) { notes.push(`gametime only reached +${gt - g0} of +${lastTick} after the fixed wait`); break; } await sleep(500); }

    const r = snbtOfReply(await C('data get storage endr:r')) || {};
    const golden = {
      pack: 'enderman', version: '1.18.2', generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
      clock: 'no player connected; every enderman in its own sealed forceloaded pen; mobGriefing false ' +
        'for the G-zone control window [0,' + G_CHECK + '], then true from ' + PU_START + ' on for P/PL/WT/AR; ' +
        'counts via `execute if entity @e[tag,nbt=...]` (success count), Health/Pos via `data get entity`',
      G_CHECK, PU_START, PU_CHECKS, PL_CHECKS, WT_CHECKS, AR_CHECKS,
      P_N: P_LANES.length, PL_N: PL_LANES.length, WT_N: WT_LANES.length, AR_N: AR_LANES.length, G_N: G_LANES.length,
      g: r.g,
      pu: PU_CHECKS.reduce((o, cp) => { o[cp] = r.p && r.p[`t${cp}`]; return o; }, {}),
      pl: PL_CHECKS.reduce((o, cp) => { o[cp] = r.pl && r.pl[`t${cp}`]; return o; }, {}),
      wt: WT_CHECKS.reduce((o, cp) => {
        o[cp] = WT_LANES.map((l) => { const c = r.wt && r.wt[`l${l.id}`] && r.wt[`l${l.id}`][`t${cp}`]; return c ? { h: c.h, x: c.x, z: c.z } : null; });
        return o;
      }, {}),
      ar: AR_CHECKS.reduce((o, cp) => {
        o[cp] = AR_LANES.map((l) => { const c = r.ar && r.ar[`l${l.id}`] && r.ar[`l${l.id}`][`t${cp}`]; return c ? { h: c.h, x: c.x, z: c.z } : null; });
        return o;
      }, {}),
      arSpawn: AR_LANES.map((l) => ({ x: (l.x + 0.5) * 1000, z: (l.z + 0.5) * 1000 })),
      wtSpawn: WT_LANES.map((l) => ({ x: (l.x + 0.5) * 1000, z: (l.z + 0.5) * 1000 })),
      notes,
    };
    const dir = join(refereeWorkDir(), 'golden');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'enderman.json');
    writeFileSync(file, JSON.stringify(golden) + '\n');
    console.log(`  G-zone (griefing off) picks by t${G_CHECK}: ${golden.g}/${golden.G_N}`);
    console.log('  pickup zone (cumulative "has carried" count):', PU_CHECKS.map((cp) => `t${cp}=${golden.pu[cp]}`).join(' '));
    console.log('  place zone (still-carrying count, out of ' + PL_LANES.length + '):', PL_CHECKS.map((cp) => `t${cp}=${golden.pl[cp]}`).join(' '));
    console.log(`referee/runenderman: ${golden.seconds} s -> ${file}`);
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
