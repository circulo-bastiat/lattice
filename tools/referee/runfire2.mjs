#!/usr/bin/env node
// runfire2.mjs — the referee's FIRE runner (burn-out, infiniburn, fuel burning away, TNT lit by fire). Infra I6, 25 Sept 2026.
// Scenarios: firescen.mjs. (runfire.mjs is the unrelated ON-FIRE LOOT runner.)
//
//   MCLITE_REFEREE_DIR=<dir> node tools/referee/runfire2.mjs      # ~2 min, the real server
//
// One server, clear weather, difficulty normal, doFireTick on, randomTickSpeed 0 (fire runs on SCHEDULED ticks: a
// forceloaded chunk is enough, no player). Every scene x REPS is built, then every fire is lit in one burst; then one
// sample per ~DT ticks for T ticks — each a fixed sleep on our own server (D-436: a bounded clock, never a poll of a queued
// job), the elapsed game time read back — recording per scene: is the lit fire cell still fire, is each fuel cell still
// its block, and (tnt) whether a primed TNT entity exists (killed on sight so it never blows the neighbours up).
// At the end: fire cells left in each scene's 5x7x5 box (a destructive `fill ... air replace fire`, last).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/fire.json
//   { T, DT, cases: { "<id>": { reps: [{ fireGone: tick|null, fuelGone: [tick|null...], tntPrimed: tick|null, fireLeft: n }] } } }
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { SCENARIOS, origin, T, DT, REPS, GY, DIFFICULTY, EXTENT } from './firescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`referee/runfire2: ${SCENARIOS.length} scenarios x ${REPS} reps, ${T} ticks`);
  const server = await startServer({ port: 25831, rconPort: 25832 });
  let rcon;
  const t0 = Date.now();
  const notes = [];
  const cmd = async (c) => {
    const r = await rcon.command(c);
    if (/Unknown|Invalid|Incorrect|Could not|expected|error|Too many|not loaded/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 120)}`);
    return r;
  };
  const isBlock = async (x, y, z, b) => /passed/i.test(await rcon.command(`execute if block ${x} ${y} ${z} ${b}`));
  const gametime = async () => +((await rcon.command('time query gametime')).match(/(\d+)/) || [])[1];
  const cases = {};
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    for (const c of ['gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doTileDrops false', 'gamerule randomTickSpeed 0',
      'gamerule doFireTick false', 'gamerule doMobSpawning false', 'weather clear 1000000', `difficulty ${DIFFICULTY}`, 'time set 6000']) await cmd(c);
    await cmd(`forceload add ${EXTENT.x0} ${EXTENT.z0} ${EXTENT.x1} ${EXTENT.z1}`);
    await sleep(3000);                       // the forceloaded chunks load (a fixed wait on our own server)
    await cmd(`fill ${EXTENT.x0} ${GY} ${EXTENT.z0} ${EXTENT.x1} ${GY} ${EXTENT.z1} minecraft:stone`);
    for (let dy = 1; dy <= 8; dy++) await cmd(`fill ${EXTENT.x0} ${GY + dy} ${EXTENT.z0} ${EXTENT.x1} ${GY + dy} ${EXTENT.z1} minecraft:air`); // one layer per fill: the 32768 cap; a rerun's leftovers go
    await cmd('kill @e[type=!minecraft:player]');
    const phaseTicks = [];
    for (const RAIN of [false, true]) {
      if (RAIN) {                            // the second phase: rain on, the first phase's scenes cleared
        for (let dy = 1; dy <= 8; dy++) await cmd(`fill ${EXTENT.x0} ${GY + dy} ${EXTENT.z0} ${EXTENT.x1} ${GY + dy} ${EXTENT.z1} minecraft:air`);
        await cmd(`fill ${EXTENT.x0} ${GY} ${EXTENT.z0} ${EXTENT.x1} ${GY} ${EXTENT.z1} minecraft:stone`);   // phase 1's netherrack/magma floors go
        await cmd('weather rain 1000000');
      }
      const all = [];
      SCENARIOS.forEach((sc, i) => { if (!!sc.rain !== RAIN) return; for (let r = 0; r < REPS; r++) all.push({ sc, i, r, o: origin(i, r), rec: { fireGone: null, fuelGone: sc.fuel.map(() => null), tntPrimed: null, fireLeft: 0 } }); });
      for (const s of all) {
        const { sc, o } = s;
        if (sc.floor) await cmd(`setblock ${o.x + sc.fire[0]} ${GY + sc.fire[1] - 1} ${o.z + sc.fire[2]} ${sc.floor}`);
        for (const [b, [x, dy, z]] of sc.fuel) await cmd(`setblock ${o.x + x} ${GY + dy} ${o.z + z} ${b}`);
      }
      // the watcher: a datapack TICK function stamps the game time the tick each watched cell stops being its block
      // (scoreboard fake players, one per cell) and kills + stamps a primed TNT — tick-exact, no RCON round trip per sample.
      const watch = [];                        // [s, kind, k, x, y, z, block]
      for (const s of all) {
        const { sc, o } = s;
        watch.push([s, 'fire', 0, o.x + sc.fire[0], GY + sc.fire[1], o.z + sc.fire[2], 'minecraft:fire']);
        sc.fuel.forEach(([b, [x, dy, z]], k) => watch.push([s, 'fuel', k, o.x + x, GY + dy, o.z + z, b]));
        if (sc.id === 'tnt') watch.push([s, 'tnt', 0, o.x, GY, o.z, null]);
      }
      const lines = [];
      watch.forEach(([s, kind, k, x, y, z, b], n) => {
        const id = '#w' + n;
        if (kind === 'tnt') lines.push(`execute if score #on fw matches 1 if score ${id} fw matches -1 if entity @e[type=minecraft:tnt,x=${x - 3},y=${y},z=${z - 3},dx=6,dy=6,dz=6] store result score ${id} fw run time query gametime`);
        else lines.push(`execute if score #on fw matches 1 if score ${id} fw matches -1 unless block ${x} ${y} ${z} ${b} store result score ${id} fw run time query gametime`);
      });
      lines.push(`kill @e[type=minecraft:tnt]`);
      await lockReferee();
      const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mclitefire');
      mkdirSync(join(dp, 'data', 'mclitefire', 'functions'), { recursive: true });
      mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
      writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee fire watcher' } }));
      writeFileSync(join(dp, 'data', 'mclitefire', 'functions', 'watch.mcfunction'), lines.join('\n') + '\n');
      writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitefire:watch'] }));
      await cmd('reload');
      await sleep(2000);                       // the reload finishes (a fixed wait on our own server)
      await cmd('scoreboard objectives add fw dummy');
      for (let n = 0; n < watch.length; n++) await cmd(`scoreboard players set #w${n} fw -1`);
      // lit with doFireTick OFF (the fire's own scheduled tick is queued, and does nothing), so no fire starts before the clock
      for (const s of all) await cmd(`setblock ${s.o.x + s.sc.fire[0]} ${GY + s.sc.fire[1]} ${s.o.z + s.sc.fire[2]} minecraft:fire`);
      await cmd('scoreboard players set #on fw 1');
      const g0 = await gametime();
      await cmd('gamerule doFireTick true');
      await sleep(T * 50 * 1.3 + 2000);        // the ONE bounded wait (D-436)
      await cmd('scoreboard players set #on fw 0');
      for (let n = 0; n < watch.length; n++) {
        const [s, kind, k] = watch[n];
        const v = +(((await rcon.command(`scoreboard players get #w${n} fw`)).match(/has (-?\d+)/) || [])[1]);
        const t = v >= 0 ? Math.max(0, v - g0) : null;
        if (!Number.isFinite(v)) notes.push(`score #w${n} unreadable`);
        if (kind === 'fire') s.rec.fireGone = t; else if (kind === 'fuel') s.rec.fuelGone[k] = t; else s.rec.tntPrimed = t;
      }
      await cmd('gamerule doFireTick false');
      const ticks = (await gametime()) - g0;
      if (ticks < T) notes.push(`only ${ticks}/${T} ticks elapsed`);
      for (const s of all) {
        const { o } = s;
        const r = await rcon.command(`fill ${o.x - 2} ${GY + 1} ${o.z - 2} ${o.x + 2} ${GY + 7} ${o.z + 2} minecraft:air replace minecraft:fire`);
        s.rec.fireLeft = +((r.match(/filled (\d+)/) || [])[1] || 0);
      }
      for (const s of all) (cases[s.sc.id] = cases[s.sc.id] || { reps: [] }).reps.push(s.rec);
      phaseTicks.push(ticks);
    }
    cases._ticks = Math.min(...phaseTicks);
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const ticks = cases._ticks; delete cases._ticks;
  const golden = { pack: 'fire', version: '1.18.2', T, DT, REPS, ticks, difficulty: DIFFICULTY,
    clock: 'all built, doFireTick on, every fire lit in one burst; a sample per ~DT ticks: lit cell still fire? fuel still there? tnt primed? — fire cells left in the 5x7x5 box at the end',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'fire.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runfire2: ${ticks} ticks in ${golden.seconds} s -> ${out}`);
  for (const sc of SCENARIOS) {
    const c = cases[sc.id];
    console.log(`  ${sc.id.padEnd(11)} fireGone ${c.reps.map((r) => r.fireGone ?? '-').join(',')} | fuelGone ${c.reps.map((r) => r.fuelGone.filter((v) => v !== null).length + '/' + r.fuelGone.length).join(',')} | tnt ${c.reps.map((r) => r.tntPrimed ?? '-').join(',')} | left ${c.reps.map((r) => r.fireLeft).join(',')}`);
  }
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
