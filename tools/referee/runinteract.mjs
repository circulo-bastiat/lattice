#!/usr/bin/env node
// runinteract.mjs — the referee's MOB RIGHT-CLICK INTERACTIONS runner (infra I6, s145). Scenarios: interactscen.mjs.
//   node tools/referee/runinteract.mjs [--only <regex>]      (31 scenes x 2 batches x 6 clicks, ~6 min; --only merges into interact.json)
// ONE growbot survival player. Per batch: every non-player entity killed, BATCH NoAI NBT-summoned mobs on a 3 x 2 grid 4..5 blocks
// +z of the bot; per click: `clear`, exactly n of the item in the main hand, one Interact packet, 0.35 s, then the main hand read
// with `data get entity br0 SelectedItem` and the `gets` item counted in the whole inventory. Per batch, through a scoreboard
// (an `execute if` that matches nothing sends no RCON reply): dropped item totals per `drops` id, SUM(flag NBT) of the clicked
// mobs, clicked mobs still there, `becomes` mobs. Own port 25871 + work dir (MCLITE_INTERACT_WORKDIR, default
// ~/.mclite-referee-interact); golden -> <referee dir>/golden/interact.json.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, BATCH, BATCHES } from './interactscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const ONLY = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
const num = (r) => { const m = /has (-?\d+)/.exec(String(r)); return m ? +m[1] : NaN; };
function parseHeld(r) {
  const s = String(r);
  const id = /id: "minecraft:([a-z_]+)"/.exec(s), cnt = /Count: (\d+)b/.exec(s), dmg = /Damage: (\d+)/.exec(s);
  return id ? { id: id[1], n: cnt ? +cnt[1] : 1, dmg: dmg ? +dmg[1] : 0 } : { id: '', n: 0, dmg: 0 };
}
async function main() {
  const workDir = process.env.MCLITE_INTERACT_WORKDIR || join(homedir(), '.mclite-referee-interact');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25871, rconPort: 26871, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    const score = async (obj) => num(await C(`scoreboard players get #r ${obj}`));
    for (const c of ['difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'forceload add -16 -16 16 16',
      `fill -6 ${FLOOR - 1} -4 6 ${FLOOR + 4} 8 minecraft:air`, `fill -6 ${FLOOR - 1} -4 6 ${FLOOR - 1} 8 minecraft:stone`,
      'scoreboard objectives add c dummy', 'scoreboard objectives add f dummy', 'scoreboard objectives add r dummy']) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'br0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival br0');
    await C(`tp br0 0.5 ${FLOOR} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await sleep(3500);
    for (const s of SCEN.filter((q) => !ONLY || ONLY.test(q.id))) {
      const c = cases[s.id] = { attempts: 0, held: {}, gets: 0, drops: {}, flag: 0, alive: 0, becomes: 0 };
      for (const d of s.drops || []) c.drops[d] = 0;
      for (let b = 0; b < BATCHES; b++) {
        await C('kill @e[type=!player]');
        const n0 = bot.spawnedIds.length;
        for (let i = 0; i < BATCH; i++) {
          const x = (i % 3) - 1 + 0.5, z = Math.floor(i / 3) + 4 + 0.5;   // 4..5 blocks off: a survival bot 2 blocks away PICKS UP some drops (55/60 mushrooms, empirical)
          await C(`summon minecraft:${s.mob} ${x} ${FLOOR} ${z} {NoAI:1b,PersistenceRequired:1b,Silent:1b${s.nbt ? ',' + s.nbt : ''},Tags:["bf"]}`);
        }
        await sleep(800);
        const ids = bot.spawnedIds.slice(n0, n0 + BATCH);
        if (bot.spawnedIds.length - n0 !== BATCH) notes.push(`${s.id} batch ${b}: saw ${bot.spawnedIds.length - n0} spawn ids, expected ${BATCH}`);
        for (const id of ids) {
          await C('clear br0');
          await C(`item replace entity br0 weapon.mainhand with minecraft:${s.item} ${s.n}`);
          await sleep(120);
          bot.interact(id);
          await sleep(350);
          const h = parseHeld(await C('data get entity br0 SelectedItem'));
          const k = `${h.id}x${h.n}${h.dmg ? '@' + h.dmg : ''}`;
          c.held[k] = (c.held[k] || 0) + 1;
          if (s.gets) { const m = /Found (\d+) matching/.exec(await C(`clear br0 minecraft:${s.gets} 0`)); c.gets += m ? +m[1] : 0; }
          c.attempts++;
        }
        await sleep(600);
        for (const d of s.drops || []) {
          await C(`execute as @e[type=item,nbt={Item:{id:"minecraft:${d}"}}] store result score @s c run data get entity @s Item.Count`);
          await C('scoreboard players set #r c 0');
          await C(`scoreboard players operation #r c += @e[type=item,nbt={Item:{id:"minecraft:${d}"}}] c`);
          c.drops[d] += await score('c');
        }
        if (s.flag) {
          await C(`execute as @e[tag=bf] store result score @s f run data get entity @s ${s.flag}`);
          await C('scoreboard players set #r f 0');
          await C('scoreboard players operation #r f += @e[tag=bf] f');
          c.flag += await score('f');
        }
        await C('execute store result score #r r if entity @e[tag=bf]');
        c.alive += await score('r');
        if (s.becomes) { await C(`execute store result score #r r if entity @e[type=${s.becomes}]`); c.becomes += await score('r'); }
      }
      console.log(`  ${s.id.padEnd(28)} n ${c.attempts} held ${JSON.stringify(c.held)} gets ${c.gets} drops ${JSON.stringify(c.drops)} flag ${c.flag} alive ${c.alive} becomes ${c.becomes}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'interact', version: '1.18.2', BATCH, BATCHES,
    clock: 'growbot survival, inventory cleared + n of the item per click, one Interact per NoAI NBT-summoned mob, 0.35 s -> main hand, inventory, drops, flag NBT',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  if (ONLY && existsSync(join(dir, 'interact.json'))) {
    const old = JSON.parse(readFileSync(join(dir, 'interact.json'), 'utf8'));
    golden.cases = Object.assign({}, old.cases, cases); golden.notes = (old.notes || []).concat(notes); golden.seconds += old.seconds || 0;
  }
  writeFileSync(join(dir, 'interact.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runinteract: ${golden.seconds} s -> ${join(dir, 'interact.json')}${notes.length ? '\n  notes: ' + notes.slice(0, 5).join(' | ') : ''}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
