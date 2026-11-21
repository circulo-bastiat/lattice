#!/usr/bin/env node
// runbreed.mjs — the referee's BREEDING / FEEDING runner (infra I6, s145). Scenarios: breedscen.mjs.
//   node tools/referee/runbreed.mjs [--only <regex>]   (44 feed scenes x 2 batches x 10 clicks + 6 mate scenes x 6 pens)
// FEED: ONE growbot survival player. Per batch: every non-player entity killed, BATCH fed mobs summoned WITH NBT (NoAI, Age)
// on a 5 x 2 grid 2..3 blocks +z of the bot (inside the interact range) and BATCH control mobs (same NBT) at z 7..8, one
// Interact packet per FED mob (bucket items: the one-item stack re-given before every click), 1.5 s, then through a scoreboard
// (an `execute if` that matches nothing sends no RCON reply, harness fact 11): SUM(Age) fed/control, SUM(ForcedAge) fed, how
// many fed mobs are in love (InLove > 0), alive, items used, water buckets handed back.
// MATE: no bot needed; PENS glass pens (3x3 inside, 3 high), two adults each summoned with InLove:600 and real AI; after
// WAIT_MATE_MS, per pen: babies, 2*SUM(baby Age) + SUM(parent Age), parents still in love; plus the total XP orb value.
// Own port 25861 + work dir (MCLITE_BREED_WORKDIR, default ~/.mclite-referee-breed); golden -> <referee dir>/golden/breed.json.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { FEED, MATE, BATCH, BATCHES, PENS, WAIT_MATE_MS } from './breedscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
// --only <regex>: run just the matching scene ids and MERGE them into an existing breed.json (a full run is > 10 min on 2 cores)
const ONLY = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
const want = (s) => !ONLY || ONLY.test(s.id);
const num = (r) => { const m = /(-?\d+)\s*$/.exec(String(r).trim()) || /has (-?\d+)/.exec(String(r)); return m ? +m[1] : NaN; };
async function main() {
  const workDir = process.env.MCLITE_BREED_WORKDIR || join(homedir(), '.mclite-referee-breed');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25861, rconPort: 26861, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    // a scoreboard read that ALWAYS answers: store into a fake holder, then get it
    const score = async (obj) => num(await C(`scoreboard players get #r ${obj}`));
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -48 -48 48 48',
      `fill -8 ${FLOOR - 1} -40 40 ${FLOOR + 5} 10 minecraft:air`, `fill -8 ${FLOOR - 1} -40 40 ${FLOOR - 1} 10 minecraft:grass_block`,
      'scoreboard objectives add age dummy', 'scoreboard objectives add fage dummy', 'scoreboard objectives add love dummy',
      'scoreboard objectives add xp dummy', 'scoreboard objectives add r dummy']) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'br0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival br0');
    await C(`tp br0 0.5 ${FLOOR} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    await sleep(3500);
    // ── FEED ──────────────────────────────────────────────────────────────────────────────────
    for (const s of FEED.filter(want)) {
      const c = cases[s.id] = { attempts: 0, love: 0, ageFed: 0, ageCtl: 0, forced: 0, alive: 0, used: 0, water: 0 };
      const single = /_bucket$/.test(s.item);
      for (let b = 0; b < BATCHES; b++) {
        await C('kill @e[type=!player]');
        await C('clear br0');
        if (!single) await C(`item replace entity br0 weapon.mainhand with minecraft:${s.item} 64`);
        const n0 = bot.spawnedIds.length;
        const nbt = (tag) => `{NoAI:1b,PersistenceRequired:1b,Silent:1b,Age:${s.age},Tags:["${tag}"]}`;
        for (let i = 0; i < BATCH; i++) {
          const x = (i % 5) - 2 + 0.5, z = Math.floor(i / 5) + 2 + 0.5;
          await C(`summon minecraft:${s.mob} ${x} ${FLOOR} ${z} ${nbt('bf')}`);
        }
        for (let i = 0; i < BATCH; i++) {
          const x = (i % 5) - 2 + 0.5, z = Math.floor(i / 5) + 7 + 0.5;
          await C(`summon minecraft:${s.mob} ${x} ${FLOOR} ${z} ${nbt('bc')}`);
        }
        await sleep(1000);
        const ids = bot.spawnedIds.slice(n0, n0 + BATCH);
        if (bot.spawnedIds.length - n0 !== 2 * BATCH) notes.push(`${s.id} batch ${b}: saw ${bot.spawnedIds.length - n0} spawn ids, expected ${2 * BATCH}`);
        let used = 0, water = 0;
        for (const id of ids) {
          if (single) {
            await C(`item replace entity br0 weapon.mainhand with minecraft:${s.item} 1`);
            await sleep(120);
            bot.interact(id);
            await sleep(250);
            if (/Found 1 matching/.test(await C('clear br0 minecraft:water_bucket 0'))) water++;
            if (!/Found 1 matching/.test(await C(`clear br0 minecraft:${s.item} 0`))) used++;
          } else bot.interact(id);
        }
        await sleep(1500);
        for (const [obj, tag, path] of [['age', 'bf', 'Age'], ['age', 'bc', 'Age'], ['fage', 'bf', 'ForcedAge'], ['love', 'bf', 'InLove']]) {
          await C(`execute as @e[tag=${tag}] store result score @s ${obj} run data get entity @s ${path}`);
          await C(`scoreboard players set #r ${obj} 0`);
          await C(`scoreboard players operation #r ${obj} += @e[tag=${tag}] ${obj}`);
          const v = await score(obj);
          if (path === 'Age') { if (tag === 'bf') c.ageFed += v; else c.ageCtl += v; }
          else if (path === 'ForcedAge') c.forced += v;
        }
        await C('execute store result score #r love if entity @e[tag=bf,scores={love=1..}]');
        c.love += await score('love');
        await C('execute store result score #r r if entity @e[tag=bf]');
        c.alive += await score('r');
        if (!single) {
          const left = /Found (\d+) matching/.exec(await C(`clear br0 minecraft:${s.item} 0`));
          used = 64 - (left ? +left[1] : 0);
        }
        c.attempts += ids.length; c.used += used; c.water += water;
      }
      console.log(`  ${s.id.padEnd(24)} n ${c.attempts} love ${c.love} ageFed-ageCtl ${c.ageFed - c.ageCtl} forced ${c.forced} used ${c.used} water ${c.water} alive ${c.alive}`);
    }
    // ── MATE ──────────────────────────────────────────────────────────────────────────────────
    for (const s of MATE.filter(want)) {
      await C('kill @e[type=!player]');
      const pens = [];
      for (let k = 0; k < PENS; k++) {
        const px = k * 6, pz = -20;
        pens.push({ px, pz });
        // stone floor: a baby SHEEP eating grass grows up 60 s (SheepEntity.onEatingGrass) and would break the invariant
        await C(`fill ${px - 2} ${FLOOR - 1} ${pz - 2} ${px + 2} ${FLOOR - 1} ${pz + 2} minecraft:stone`);
        await C(`fill ${px - 2} ${FLOOR} ${pz - 2} ${px + 2} ${FLOOR + 2} ${pz + 2} minecraft:glass`);
        await C(`fill ${px - 1} ${FLOOR} ${pz - 1} ${px + 1} ${FLOOR + 2} ${pz + 1} minecraft:air`);
        for (const dx of [-0.5, 0.5]) await C(`summon minecraft:${s.mob} ${px + 0.5 + dx} ${FLOOR} ${pz + 0.5} {PersistenceRequired:1b,Silent:1b,InLove:600,Age:0,Tags:["bp"]}`);
      }
      await sleep(WAIT_MATE_MS);
      const c = cases[s.id] = { pairs: PENS, babies: 0, invariant: [], parentsInLove: 0, xp: 0, orbs: 0 };
      await C(`execute as @e[type=${s.mob}] store result score @s age run data get entity @s Age`);
      await C(`execute as @e[tag=bp] store result score @s love run data get entity @s InLove`);
      for (const p of pens) {
        const sel = `type=${s.mob},x=${p.px - 1},y=${FLOOR},z=${p.pz - 1},dx=3,dy=3,dz=3`;
        await C(`execute store result score #r r if entity @e[${sel},scores={age=..-1}]`);
        const nb = await score('r');
        c.babies += nb;
        await C('scoreboard players set #r age 0');
        await C(`scoreboard players operation #r age += @e[${sel},scores={age=..-1}] age`);
        await C(`scoreboard players operation #r age += @e[${sel},scores={age=..-1}] age`);
        await C(`scoreboard players operation #r age += @e[${sel},tag=bp] age`);
        if (nb === 1) c.invariant.push(await score('age'));
      }
      await C('execute store result score #r love if entity @e[tag=bp,scores={love=1..}]');
      c.parentsInLove = await score('love');
      await C('execute as @e[type=experience_orb] store result score @s xp run data get entity @s Value');
      await C('scoreboard players set #r xp 0');
      await C('scoreboard players operation #r xp += @e[type=experience_orb] xp');
      c.xp = await score('xp');
      await C('execute store result score #r r if entity @e[type=experience_orb]');
      c.orbs = await score('r');
      console.log(`  ${s.id.padEnd(24)} pairs ${c.pairs} babies ${c.babies} invariant ${JSON.stringify(c.invariant)} parentsInLove ${c.parentsInLove} xp ${c.xp} orbs ${c.orbs}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'breed', version: '1.18.2', BATCH, BATCHES, PENS, WAIT_MATE_MS,
    clock: 'FEED: growbot survival, one Interact per NoAI NBT-summoned mob, fed-minus-control Age sums; MATE: InLove:600 pairs in glass pens with AI',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  if (ONLY && existsSync(join(dir, 'breed.json'))) {
    const old = JSON.parse(readFileSync(join(dir, 'breed.json'), 'utf8'));
    golden.cases = Object.assign({}, old.cases, cases);
    golden.notes = (old.notes || []).concat(notes);
    golden.seconds += old.seconds || 0;
  }
  writeFileSync(join(dir, 'breed.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runbreed: ${golden.seconds} s -> ${join(dir, 'breed.json')}${notes.length ? '\n  notes: ' + notes.slice(0, 5).join(' | ') : ''}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
