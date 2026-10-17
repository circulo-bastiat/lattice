#!/usr/bin/env node
// runspawner.mjs — the referee's MOB SPAWNER runner (infra I6, s150). Rooms: spawnerscen.mjs.
// Every room is built in the air over the flat world (forceloaded), one growbot CREATIVE player hovers
// over the grid (RequiredPlayerRange 64 reaches every room); all spawners are placed in ONE tick by a
// datapack function with Delay:20 (the field default a placed spawner starts with, MobSpawnerLogic:28 —
// RequiredPlayerRange is only read alongside MaxNearbyEntities, :223-226, so both are given;
// a /setblock without Delay would read 0). A datapack TICK function counts, per room, the mobs inside
// the room's box, remembers the first gametime it saw one, and (not in `keep` rooms) sends them to the
// void at once, so the nearby cap never binds. Scores read at gametime CHECKPOINTS from the placement.
//
//   node tools/referee/runspawner.mjs            (~6 min)
//   node tools/referee/runspawner.mjs --merge    (another run, added to the golden's counts)
//   node tools/referee/runspawner.mjs --set 2 --merge   (SET 2: 13 more types, added to the same golden; --set 3: blaze_dark)
//
// Own port 25872 / rcon 26872, work dir $MCLITE_SPAWNER_WORKDIR or ~/.mclite-referee-spawner;
// golden -> golden/spawner.json.
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, SCEN2, roomsOf, Y, T, CHECKPOINTS, RANGE, PEN, PLAYER as PLAYER1, PLAYER2, floorAt } from './spawnerscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MERGE = process.argv.includes('--merge');
const SET = process.argv.includes('--set') ? parseInt(process.argv[process.argv.indexOf('--set') + 1], 10) : 1;
const ROOMS = roomsOf(SET), SCENS = SET === 1 ? SCEN : SCEN2.filter((s) => s.set === SET), PLAYER = SET === 1 ? PLAYER1 : PLAYER2;

const box = (r) => `x=${r.X - 5},y=${Y - 2},z=${r.Z - 5},dx=10,dy=5,dz=10`;

async function main() {
  const workDir = process.env.MCLITE_SPAWNER_WORKDIR || join(homedir(), '.mclite-referee-spawner');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitespw');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'spw', 'functions'), { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee spawner' } }));
  const place = ['scoreboard players set #on spw 1'], tick = ['execute unless score #on spw matches 1 run return 0'];
  // (1.18.2 has no `return`: the guard is an `execute if` prefix on every line instead)
  tick.length = 0;
  ROOMS.forEach((r, k) => {
    const s = r.s;
    place.push(`setblock ${r.X} ${Y} ${r.Z} minecraft:spawner{SpawnData:{entity:{id:"minecraft:${s.mob}"}},Delay:20s,MaxNearbyEntities:6s,RequiredPlayerRange:${s.range || RANGE}s}`);
    place.push(`scoreboard players set #n${k} spw 0`, `scoreboard players set #f${k} spw 0`);
    const on = 'execute if score #on spw matches 1 run ';
    // only mobs not seen before are counted (tagged on sight): a mob the void-tp below fails to move must not be re-counted
    tick.push(`${on}execute store result score #c${k} spw if entity @e[type=minecraft:${s.mob},${box(r)},tag=!spwseen]`);
    tick.push(`${on}tag @e[type=minecraft:${s.mob},${box(r)},tag=!spwseen] add spwseen`);
    tick.push(`execute if score #on spw matches 1 if score #c${k} spw matches 1.. if score #f${k} spw matches 0 store result score #f${k} spw run time query gametime`);
    if (!s.keep) {
      tick.push(`${on}scoreboard players operation #n${k} spw += #c${k} spw`);
      tick.push(`${on}tp @e[type=minecraft:${s.mob},${box(r)}] ${r.X} -300 ${r.Z}`);
    }
  });
  writeFileSync(join(dp, 'data', 'spw', 'functions', 'place.mcfunction'), place.join('\n') + '\n');
  writeFileSync(join(dp, 'data', 'spw', 'functions', 'tick.mcfunction'), tick.join('\n') + '\n');
  const pen = [];
  for (let i = 0; i < PEN.n; i++) pen.push(`summon minecraft:zombie ${PEN.x - 3.5 + (i % 8)} ${PEN.y} ${PEN.z - 3.5 + (Math.floor(i / 8) % 8)} {Tags:["pen"]}`);
  writeFileSync(join(dp, 'data', 'spw', 'functions', 'pen.mcfunction'), pen.join('\n') + '\n');
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['spw:tick'] }));

  const server = await startServer({ workDir, port: 25872, rconPort: 26872, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword, timeoutMs: 60000 }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c, 60000);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doMobLoot false', 'gamerule maxEntityCramming 0',
      'scoreboard objectives add spw dummy', 'scoreboard players set #on spw 0',
      SET !== 1 ? 'forceload add -16 -16 176 48' : 'forceload add -16 -16 96 80', 'datapack enable "file/mclitespw"']) await C(c);
    await C('kill @e[type=!minecraft:player]');
    // the rooms
    for (const r of ROOMS) {
      const s = r.s;
      await C(`fill ${r.X - 5} ${Y - 2} ${r.Z - 5} ${r.X + 5} ${Y + 3} ${r.Z + 5} minecraft:stone`);
      await C(`fill ${r.X - 4} ${Y - 1} ${r.Z - 4} ${r.X + 4} ${Y + (s.sealed ? 2 : 3)} ${r.Z + 4} minecraft:air`);
      if (!s.sealed) await C(`fill ${r.X - 4} ${Y + 3} ${r.Z - 4} ${r.X + 4} ${Y + 3} ${r.Z + 4} minecraft:air`);
      for (let x = r.X - 4; x <= r.X + 4; x++) { const f = floorAt(r, x, r.Z); if (f !== 'stone') await C(`fill ${x} ${Y - 2} ${r.Z - 4} ${x} ${Y - 2} ${r.Z + 4} minecraft:${f}`); }
      if (s.lamp) await C(`setblock ${r.X} ${Y + 2} ${r.Z} minecraft:light[level=${s.lamp}]`);
    }
    // the atcap pen (sealed, dark) + its 80 zombies
    await C(`fill ${PEN.x - 5} ${PEN.y - 1} ${PEN.z - 5} ${PEN.x + 5} ${PEN.y + 3} ${PEN.z + 5} minecraft:stone`);
    await C(`fill ${PEN.x - 4} ${PEN.y} ${PEN.z - 4} ${PEN.x + 4} ${PEN.y + 2} ${PEN.z + 4} minecraft:air`);
    // the player's own glass box
    await C(`fill ${Math.floor(PLAYER.x) - 1} ${PLAYER.y - 1} ${Math.floor(PLAYER.z) - 1} ${Math.floor(PLAYER.x) + 1} ${PLAYER.y + 2} ${Math.floor(PLAYER.z) + 1} minecraft:glass`);
    await C(`fill ${Math.floor(PLAYER.x)} ${PLAYER.y} ${Math.floor(PLAYER.z)} ${Math.floor(PLAYER.x)} ${PLAYER.y + 1} ${Math.floor(PLAYER.z)} minecraft:air`);
    await sleep(1500);
    bot = await connectFakePlayer({ port: server.port, name: 'spw0', confirmTeleports: true });
    await sleep(1000);
    await C('gamemode creative spw0');
    await C(`tp spw0 ${PLAYER.x} ${PLAYER.y} ${PLAYER.z} 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(PLAYER.x, PLAYER.y, PLAYER.z, true); }, 50);
    await sleep(1500);
    if (SET === 1) notes.push('pen: ' + (await C('function spw:pen')).trim());
    await sleep(500);
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const score = async (h) => { const m = /has (-?\d+)/.exec(await C(`scoreboard players get ${h} spw`)); return m ? parseInt(m[1], 10) : NaN; };
    const countIn = async (r) => { const m = /count:\s*(\d+)/.exec(await C(`execute if entity @e[type=minecraft:${r.s.mob},${box(r)}]`)); return m ? parseInt(m[1], 10) : 0; };
    const out = await C('function spw:place');
    notes.push('place: ' + out.trim());
    const g0 = await gametime();
    const per = ROOMS.map(() => ({ n: CHECKPOINTS.map(() => 0), first: 0 }));
    for (const [ci, cp] of CHECKPOINTS.entries()) {
      let gt = await gametime();
      if (gt < g0 + cp) await sleep((g0 + cp - gt) * 50);
      for (let q = 0; q < 60 && (gt = await gametime()) < g0 + cp; q++) await sleep(50);
      if (gt > g0 + cp + 20) notes.push(`checkpoint ${cp} read late at +${gt - g0}`);
      for (const r of ROOMS) if (!r.s.keep) { const lg = await countIn(r); if (lg) notes.push(`t${cp} ${r.id}: ${lg} counted mob(s) still in the box`); }
      for (const [k, r] of ROOMS.entries()) per[k].n[ci] = r.s.keep ? await countIn(r) : await score(`#n${k}`);
      console.log(`  t${cp}: ` + ROOMS.map((r, k) => per[k].n[ci]).join(' '));
    }
    for (const [k] of ROOMS.entries()) { const f = await score(`#f${k}`); per[k].first = f > 0 ? f - g0 : -1; }
    if (SET === 1) notes.push('pen zombies alive at end: ' + (await C('execute if entity @e[tag=pen]')).trim());
    await C('scoreboard players set #on spw 0');
    for (const s of SCENS) {
      const rooms = ROOMS.map((r, k) => ({ r, p: per[k] })).filter((q) => q.r.s === s);
      cases[s.id] = { n: rooms.map((q) => q.p.n), first: rooms.map((q) => q.p.first) };
      console.log(`  ${s.id.padEnd(14)} end ${rooms.map((q) => q.p.n[q.p.n.length - 1]).join('/')} first ${rooms.map((q) => q.p.first).join('/')}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  const file = join(dir, 'spawner.json');
  mkdirSync(dir, { recursive: true });
  let golden = { pack: 'spawner', version: '1.18.2', checkpoints: CHECKPOINTS, T,
    clock: 'spawners placed in one tick (Delay:20s, RequiredPlayerRange 64) by a datapack function; a datapack tick function counts each room\'s mobs (by type, in the room box), notes the first gametime it saw one, and voids them (not in keep rooms); scores read at gametime checkpoints from the placement; creative growbot over the grid; day, doMobSpawning off, normal',
    generatedAt: new Date().toISOString(), seconds: 0, cases: {}, notes: [] };
  if (MERGE && existsSync(file)) golden = JSON.parse(readFileSync(file, 'utf8'));
  for (const [id, c] of Object.entries(cases)) {
    const g = golden.cases[id] || (golden.cases[id] = { n: [], first: [] });
    g.n.push(...c.n); g.first.push(...c.first);
  }
  golden.seconds += Math.round((Date.now() - t0) / 1000);
  golden.notes.push(...notes);
  writeFileSync(file, JSON.stringify(golden) + '\n');
  console.log(`referee/runspawner: ${Math.round((Date.now() - t0) / 1000)} s -> ${file}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
