#!/usr/bin/env node
// rungeardrop.mjs — the referee's MOB GEAR DROP runner (infra I6, 25 Sept 2026). Scenarios: geardropscen.mjs.
//   node tools/referee/rungeardrop.mjs     (2 lanes x KILLS/BATCH batches, ~3 min)
// ONE growbot survival player holding a netherite sword (Looting 0 / III by lane); per batch BATCH zombies summoned WITH NBT
// (NoAI, Health 1, the GEAR list with its drop chances) 3 blocks +z; their Spawn Living Entity ids seen, one Attack packet each
// (Strength 101: one blow kills; the victim's playerHitTimer and the killer's Looting feed dropEquipment); 1 s; then every dropped gear item
// counted by id and each leggings/boots item's Damage + enchantment ids read and the item killed. maxEntityCramming 0.
// Own port 25741 + work dir (MCLITE_GEARDROP_WORKDIR, default ~/.mclite-referee-geardrop); golden -> <referee dir>/golden/gear-drop.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { GEAR, LANES, KILLS, BATCH } from './geardropscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const st = (g) => `{id:"minecraft:${g.item}",Count:1b${g.ench ? `,tag:{Enchantments:[${g.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}}`;
const bySlot = (s) => GEAR.find((g) => g.slot === s);
const arm = ['feet', 'legs', 'chest', 'head'].map(bySlot);
const NBT = `{NoAI:1b,PersistenceRequired:1b,Silent:1b,Health:1f,HandItems:[${st(bySlot('mainhand'))},${st(bySlot('offhand'))}],HandDropChances:[${bySlot('mainhand').chance}f,${bySlot('offhand').chance}f],` +
  `ArmorItems:[${arm.map(st).join(',')}],ArmorDropChances:[${arm.map((g) => g.chance + 'f').join(',')}]}`;
async function main() {
  const workDir = process.env.MCLITE_GEARDROP_WORKDIR || join(homedir(), '.mclite-referee-geardrop');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25741, rconPort: 26741, xmx: '1024M' });
  const t0 = Date.now();
  const lanes = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule maxEntityCramming 0', 'gamerule doMobLoot true', 'forceload add -16 -16 16 16',
      `fill -5 ${FLOOR - 1} -4 5 ${FLOOR + 4} 8 minecraft:air`, `fill -5 ${FLOOR - 1} -4 5 ${FLOOR - 1} 8 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'gd0', confirmTeleports: true, captureVelocity: true });
    await sleep(1500);
    await C('gamemode survival gd0');
    await C(`tp gd0 0.5 ${FLOOR} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, FLOOR, 0.5, true); }, 50);
    // Strength 101: every blow kills a Health-1 zombie through its 17 armour even at the ~0.04 charge the 2nd..40th blow of a
    // batch carries (a first run without it left half of each batch alive, later /kill-ed with the player-hit flag still set).
    await C('effect give gd0 minecraft:strength 100000 100 true');
    await sleep(3000);
    // a count through a scoreboard: an `execute if entity` that matches nothing sends NO RCON reply on this server (a 10 s timeout,
    // seen 25 Sept) -- so zero, add one per match (a quiet no-match is caught after 3 s), and read the score, which always replies.
    await C('scoreboard objectives add gd dummy');
    const cnt = async (sel) => {
      await C('scoreboard players set #n gd 0');
      await rcon.command(`execute as ${sel} run scoreboard players add #n gd 1`, 3000).catch(() => '');
      const m = /has (-?\d+) \[/.exec(await C('scoreboard players get #n gd'));
      return m ? +m[1] : NaN;
    };
    const count = (id) => cnt(`@e[type=item,nbt={Item:{id:"minecraft:${id}"}}]`);
    for (const [lane, lvl] of Object.entries(LANES)) {
      const rec = lanes[lane] = { kills: 0, items: {}, damage: { iron_leggings: [], iron_boots: [] }, enchanted: { iron_leggings: 0, iron_boots: 0 }, errs: 0 };
      for (const g of GEAR) rec.items[g.item] = 0;
      await C(`item replace entity gd0 weapon.mainhand with minecraft:netherite_sword${lvl ? `{Enchantments:[{id:"minecraft:looting",lvl:${lvl}s}]}` : ''}`);
      for (let b = 0; b < KILLS / BATCH; b++) {
        await C('kill @e[type=!player]');
        const n0 = bot.spawnedIds.length;
        for (let k = 0; k < BATCH; k++) await C(`summon minecraft:zombie ${0.5 + (k % 5) - 2} ${FLOOR} ${3.5 + ((k / 5) | 0) % 2} ${NBT}`);
        await sleep(800);
        const ids = bot.spawnedIds.slice(n0);
        if (ids.length !== BATCH) notes.push(`${lane} batch ${b}: ${ids.length}/${BATCH} spawn ids`);
        await C('kill @e[type=item]');   // late-loading entity sections of an earlier run's world
        for (const id of ids) bot.attack(id);
        await sleep(2000);
        const alive = await cnt('@e[type=zombie]');
        rec.kills += ids.length - alive; rec.errs += alive;
        for (const g of GEAR) rec.items[g.item] += await count(g.item);
        for (const it of (b === 0 ? ['iron_leggings', 'iron_boots'] : b < 10 ? ['iron_leggings'] : [])) {
          for (let guard = 0; guard < 2 * KILLS; guard++) {
            const at = `execute positioned 0.5 ${FLOOR} 0.5 run`, sel = `@e[type=item,nbt={Item:{id:"minecraft:${it}"}},limit=1,sort=nearest]`;
            const r = await C(`${at} data get entity ${sel} Item.tag`);
            if (/No entity was found/.test(r)) break;
            const d = /Damage:\s*(\d+)/.exec(r);
            rec.damage[it].push(d ? +d[1] : 0);
            if (/Enchantments/.test(r)) rec.enchanted[it]++;
            await C(`${at} kill ${sel}`);
          }
        }
      }
      console.log(`  ${lane}: ${rec.kills} kills (${rec.errs} survived) · ${GEAR.map((g) => g.item + ' ' + rec.items[g.item]).join(' · ')} · leggings damage mean ${(rec.damage.iron_leggings.reduce((a, v) => a + v, 0) / Math.max(1, rec.damage.iron_leggings.length)).toFixed(1)} · boots enchanted ${rec.enchanted.iron_boots}/${rec.damage.iron_boots.length}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'gear-drop', version: '1.18.2', clock: 'growbot survival, netherite sword L0/L3, NBT NoAI zombies Health 1 in batches, one Attack each, 1.2 s, items counted',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), lanes, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'gear-drop.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/rungeardrop: ${golden.seconds} s -> ${join(dir, 'gear-drop.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
