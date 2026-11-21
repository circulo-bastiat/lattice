#!/usr/bin/env node
// runxp.mjs — the referee's MOB XP runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runxp.mjs            # every variant in xpscen.mjs (50 x 100 kills), ~2-3 min
//
// Mob XP only drops for a PLAYER kill (LivingEntity.dropXp, .decomp LivingEntity.java:1350: shouldAlwaysDropXp() ||
// playerHitTimer > 0 && shouldDropXp() && doMobLoot), and a projectile's attacker is its OWNER only while that owner is
// a live entity in the world -- so a growbot.mjs offline client joins as `xpbot`, parked 200 blocks away (orbs chase a
// player within 8 blocks, ExperienceOrbEntity.java), and every kill is an arrow summoned with Owner = xpbot's offline UUID
// straight down onto a NoAI mob. Per variant: 100 mobs on a 10x10 grid (4-block cells), 100 arrows, wait 40 ticks
// (death + orb spawn at deathTime 0, LivingEntity.java:1328-1344), then per cell sum Value x Count over its orbs with a
// datapack function (one RCON reply per cell). The waits are bounded sleeps on a server WE started, not polling (D-436).
// Own port + work dir (MCLITE_XP_WORKDIR) so it can run beside another referee runner; golden goes to the SHARED referee
// dir: <referee dir>/golden/mob-xp.json { N, variants: { id: { mob, nbt, values:[per-kill xp] } }, notes }  (D-6: generated).
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { VARIANTS, N } from './xpscen.mjs';

const BOT = 'xpbot';
const Y = -60;                  // flat world surface (server.mjs: bedrock + 2 dirt + grass from y=-64)
const CELL = 5, SIDE = 10;   // 4x4 glass wells on a 5-block pitch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// offline-mode UUID: UUID.nameUUIDFromBytes("OfflinePlayer:" + name) -- md5, version 3, IETF variant
function offlineUuidInts(name) {
  const b = createHash('md5').update('OfflinePlayer:' + name).digest();
  b[6] = (b[6] & 0x0f) | 0x30; b[8] = (b[8] & 0x3f) | 0x80;
  return [0, 4, 8, 12].map((o) => b.readInt32BE(o));
}

async function main() {
  const workDir = process.env.MCLITE_XP_WORKDIR || join(homedir(), '.mclite-referee-xp');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitexp');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitexp', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee mob xp' } }));
  writeFileSync(join(fdir, 'orb.mcfunction'), [
    'execute store result score #a mclx run data get entity @s Value',
    'execute store result score #b mclx run data get entity @s Count',
    'scoreboard players operation #a mclx *= #b mclx',
    'scoreboard players operation #s mclx += #a mclx',
  ].join('\n') + '\n');
  // RCON commands run on the server thread one tick-slice at a time (~23 s per variant as single commands), so every
  // per-cell loop is a datapack function: v<k>_spawn / v<k>_shoot, and ONE read that writes the 100 cell sums to storage.
  const [u0, u1, u2, u3] = offlineUuidInts(BOT);
  const cells = Array.from({ length: N }, (_, i) => ({ x: (i % SIDE) * CELL, z: Math.floor(i / SIDE) * CELL }));
  VARIANTS.forEach((v, k) => {
    const tag = `{NoAI:1b,Silent:1b,PersistenceRequired:1b${v.nbt ? ',' + v.nbt : ''}}`;
    writeFileSync(join(fdir, `v${k}_spawn.mcfunction`), cells.map((c) => `summon minecraft:${v.mob} ${c.x + 3} ${Y} ${c.z + 3} ${tag}`).join('\n') + '\n');
  });
  writeFileSync(join(fdir, 'shoot.mcfunction'), cells.map((c) =>
    `summon minecraft:arrow ${c.x + 3} ${Y + 5.5} ${c.z + 3} {Owner:[I;${u0},${u1},${u2},${u3}],Motion:[0.0,-3.0,0.0],damage:1000.0d,pickup:0b}`).join('\n') + '\n');
  // volley 2, low and slow: a 3-block/tick arrow from y+4 steps y+4 -> y+1 -> ground, and the 0.7-high mobs (baby cow,
  // chicken, fox, baby hoglin) survived it in the first run; the second volley starts inside their reach.
  writeFileSync(join(fdir, 'shoot2.mcfunction'), cells.map((c) =>
    `summon minecraft:arrow ${c.x + 3} ${Y + 1.3} ${c.z + 3} {Owner:[I;${u0},${u1},${u2},${u3}],Motion:[0.0,-1.0,0.0],damage:1000.0d,pickup:0b}`).join('\n') + '\n');
  // Orbs leave a death with up to +-0.2 blocks/tick sideways and 0.4 up (ExperienceOrbEntity constructor): in an open
  // grid they slid between cells (first runs: a zombie read 1..11, a ravager 0..54). Every cell is a 4x4 glass-walled
  // well, 5 high; the arrow starts above the walls.
  writeFileSync(join(fdir, 'arena.mcfunction'), [`fill 0 ${Y} 0 ${CELL * SIDE} ${Y + 4} ${CELL * SIDE} minecraft:glass`,
    ...cells.map((c) => `fill ${c.x + 1} ${Y} ${c.z + 1} ${c.x + CELL - 1} ${Y + 4} ${c.z + CELL - 1} minecraft:air`)].join('\n') + '\n');
  writeFileSync(join(fdir, 'read.mcfunction'), [`data modify storage mclitexp:r v set value [${cells.map(() => '0').join(',')}]`,
    ...cells.flatMap((c, i) => ['scoreboard players set #s mclx 0',
      `execute as @e[type=experience_orb,x=${c.x + 1},y=${Y - 1},z=${c.z + 1},dx=${CELL - 2},dy=7,dz=${CELL - 2}] run function mclitexp:orb`,
      `execute store result storage mclitexp:r v[${i}] int 1 run scoreboard players get #s mclx`])].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25611, rconPort: 26611, xmx: '1536M' });
  const t0 = Date.now();
  let rcon, bot;
  const variants = {}, notes = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'gamerule doMobLoot true', 'scoreboard objectives add mclx dummy', `forceload add 0 0 ${CELL * SIDE + 8} ${CELL * SIDE + 8}`,
      'function mclitexp:arena']) await C(c);
    const fl = await C('datapack list enabled');
    if (!/mclitexp/.test(fl)) notes.push('datapack not enabled: ' + fl.trim().slice(0, 200));
    bot = await connectFakePlayer({ port: server.port, name: BOT });
    await sleep(1500);
    const tp = await C(`tp ${BOT} 200 ${Y + 1} 200`);
    if (!/^Teleported/.test(tp)) throw new Error('bot not in the world: ' + tp);
    for (let k = 0; k < VARIANTS.length; k++) {
      const v = VARIANTS[k];
      await C(`kill @e[type=!player]`);
      await sleep(150);
      const sr = await C(`function mclitexp:v${k}_spawn`);
      const cnt = await C(`execute if entity @e[type=minecraft:${v.mob}]`);
      const nSp = +((/count: (\d+)/.exec(cnt) || [])[1] || 0);
      if (nSp !== N) { notes.push(`${v.id}: ${nSp}/${N} summoned (${sr.trim().slice(0, 120)})`); if (!nSp) continue; }
      await C('function mclitexp:shoot');
      await sleep(2500);   // 40+ ticks: every mob dead (deathTime 20 removes it; the xp spawned at death)
      const alive1 = await C(`execute if entity @e[type=minecraft:${v.mob},nbt={DeathTime:0s}]`);
      if (/count: [1-9]/.test(alive1)) { await C('function mclitexp:shoot2'); await sleep(2500); }
      const alive = await C(`execute if entity @e[type=minecraft:${v.mob},nbt={DeathTime:0s}]`);
      const nAlive = +((/count: (\d+)/.exec(alive) || [])[1] || 0);
      if (nAlive) notes.push(`${v.id}: ${nAlive} still alive after the arrows`);
      await C('function mclitexp:read');
      const r = await C('data get storage mclitexp:r v');
      const m = /\[(.*)\]/.exec(r);
      const values = m ? m[1].split(',').map((t) => parseInt(t.trim(), 10)) : [];
      if (values.length !== N) { notes.push(`${v.id}: unreadable sums (${r.trim().slice(0, 120)})`); continue; }
      const tot = await C('execute store result score #t mclx if entity @e[type=experience_orb]');
      variants[v.id] = { mob: v.mob, nbt: v.nbt, alive: nAlive, orbsInWorld: tot.trim(), values };
      console.log(`  ${v.id.padEnd(24)} mean ${(values.reduce((s, x) => s + (x || 0), 0) / N).toFixed(2)}  [${Math.min(...values)}..${Math.max(...values)}]`);
    }
  } finally {
    if (bot) bot.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'mob-xp', version: '1.18.2', N, kill: 'NoAI mob summoned with NBT (no initialize), player-owned arrow damage 1000 straight down',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), variants, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'mob-xp.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runxp: ${Object.keys(variants).length} variants in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
