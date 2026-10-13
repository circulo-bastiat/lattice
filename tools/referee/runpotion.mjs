#!/usr/bin/env node
// runpotion.mjs — the referee's PLAYER POTIONS runner (infra W, 25 Sept 2026). Scenarios:
// potionscen.mjs. Follow-on to runfood.mjs (same growbot, same one-lane pattern, same real
// Use Item packet) -- this pack's own addition is DRINKING (PotionItem/MilkBucketItem) rather
// than eating (FoodComponent items).
//
// ⚠ Same player-data guard as runfood.mjs: `/data merge entity <player>` REFUSES on a player
// (a real vanilla anti-cheat guard, confirmed empirically by the food pack) -- every pre-state
// here is reached the SAME way a real player would reach it: `/effect give ... instant_damage`
// for the healing scene's reduced starting health (the food pack's own 'starve' technique),
// `/effect give ... poison` for the milk scene's pre-poisoned state, and `/gamemode` for the
// creative scene -- never a number this file invented.
//
//   node tools/referee/runpotion.mjs      (10 scenarios x3 reps, one growbot survival player)
//
// Own port 25852 / rcon 26852, work dir ~/.mclite-referee-potion; golden -> golden/player-potion.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN } from './potionscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AX0 = 10.5, AZ0 = 0.5; // fixed spot, never moves

async function main() {
  const workDir = process.env.MCLITE_POTION_WORKDIR || join(homedir(), '.mclite-referee-potion');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true }); // a bot that died last run must not rejoin dead
  const server = await startServer({ workDir, port: 25852, rconPort: 26852, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 40 16']) await C(c);
    // naturalRegeneration false -- the healing scene's own reduced-health pre-state (one
    // instant_damage hit) must not silently regenerate back up before the potion is drunk
    // (vanilla regen only fires off a full-enough hunger bar, but this removes the confound
    // outright rather than relying on timing).
    await C(`fill -12 -17 -4 34 -12 4 minecraft:air`);
    await C(`fill -12 -17 -4 34 -17 4 minecraft:stone`);
    await sleep(1000);
    bot = await connectFakePlayer({ port: server.port, name: 'pt0', confirmTeleports: true, captureVelocity: true });
    await sleep(1000);
    await C('gamemode survival pt0');
    await C(`tp pt0 ${AX0} -16 ${AZ0} 0 0`);
    let px = AX0, py = -16, pz = AZ0, mode = 'stand';
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(px, py, pz, true); }, 50);
    await sleep(1500);

    const readRaw = async () => C('data get entity pt0');
    const snapshot = async () => {
      const raw = await readRaw();
      const g1 = (re) => { const m = re.exec(raw); return m ? m[1] : null; };
      return {
        health: parseFloat(g1(/Health:\s*([-0-9.Ee]+)f/)),
        food: parseInt(g1(/foodLevel:\s*(-?[0-9]+)/), 10),
        saturation: parseFloat(g1(/foodSaturationLevel:\s*([-0-9.Ee]+)f/)),
        raw,
      };
    };
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const hotbar0 = async () => {
      const raw = await C('data get entity pt0 Inventory[{Slot:0b}]');
      const idm = /id:\s*"minecraft:([a-z_]+)"/.exec(raw);
      const cm = /Count:\s*(\d+)b/.exec(raw);
      return { id: idm ? idm[1] : null, count: cm ? parseInt(cm[1], 10) : 0 };
    };
    const hasEffect = (raw, id) => new RegExp(`Id:\\s*${id}b`).test(raw);
    const effectDuration = (raw, id) => {
      const m = new RegExp(`Id:\\s*${id}b[^}]*?Duration:\\s*(-?\\d+)`).exec(raw)
             || new RegExp(`Duration:\\s*(-?\\d+)[^}]*?Id:\\s*${id}b`).exec(raw);
      return m ? parseInt(m[1], 10) : null;
    };
    const effectAmp = (raw, id) => {
      const m = new RegExp(`Id:\\s*${id}b[^}]*?Amplifier:\\s*(-?\\d+)`).exec(raw)
             || new RegExp(`Amplifier:\\s*(-?\\d+)[^}]*?Id:\\s*${id}b`).exec(raw);
      return m ? parseInt(m[1], 10) : null;
    };

    async function resetLane() {
      mode = 'idle';
      await C(`tp pt0 ${AX0} -16 ${AZ0} 0 0`);
      px = AX0; py = -16; pz = AZ0;
      mode = 'stand';
      await sleep(300);
    }
    async function giveAndDrink(potion, useTicks) {
      await C(`item replace entity pt0 weapon.mainhand with minecraft:potion{Potion:"minecraft:${potion}"} 1`);
      await sleep(150);
      const t0tick = await gametime();
      bot.useItem(0);
      await sleep(useTicks * 50 + 500); // hold through the full server-side use time (LivingEntity.tickActiveItemStack), plus margin
      const t1tick = await gametime();
      return { ticks: t1tick - t0tick };
    }

    for (const s of SCEN) {
      await resetLane();
      await C('gamemode survival pt0');
      await C('effect clear pt0');
      const reps = s.reps || 1;
      if (s.kind === 'drink_instant') {
        let sumDelta = 0, sumPreFood = 0, sumPostFood = 0, lastContainer = null, useTicksMeasured = 0;
        for (let r = 0; r < reps; r++) {
          await C('effect clear pt0');
          // `/data merge entity <player>` is REFUSED outright on a player, not only on a nested
          // path (runphantom.mjs/runmelee.mjs's own note, confirmed empirically well before this
          // pack) -- health is reset the SAME way every other referee unit resets a player: a
          // massively-amplified `instant_health` (amplifier 10 -> 4<<10 = 4096 healing, capped at
          // the 20 max so this always lands exactly on full, runhunger.mjs's own precedent).
          await C('effect give pt0 minecraft:instant_health 1 10 true');
          await sleep(200);
          for (let i = 0; i < s.preHits; i++) { await C('effect give pt0 minecraft:instant_damage 1 0 true'); await sleep(800); }
          await sleep(200);
          const pre = await snapshot();
          const { ticks } = await giveAndDrink(s.potion, s.useTicks);
          const post = await snapshot();
          useTicksMeasured = ticks;
          sumDelta += (post.health - pre.health); sumPreFood += pre.food; sumPostFood += post.food;
          if (r === 0) lastContainer = await hotbar0();
        }
        cases[s.id] = { preHealthHits: s.preHits, healthDelta: sumDelta / reps, preFood: sumPreFood / reps, postFood: sumPostFood / reps,
          container: lastContainer, useTicksMeasured };
      } else if (s.kind === 'drink_effect') {
        let sumPreFood = 0, sumPostFood = 0, present = 0, durSum = 0, ampVals = new Set(), lastContainer = null, useTicksMeasured = 0;
        for (let r = 0; r < reps; r++) {
          await C('effect clear pt0');
          const pre = await snapshot();
          const { ticks } = await giveAndDrink(s.potion, s.useTicks);
          const post = await snapshot();
          useTicksMeasured = ticks;
          sumPreFood += pre.food; sumPostFood += post.food;
          if (hasEffect(post.raw, s.effect.id)) { present++; durSum += effectDuration(post.raw, s.effect.id); ampVals.add(effectAmp(post.raw, s.effect.id)); }
          if (r === 0) lastContainer = await hotbar0();
        }
        cases[s.id] = { preFood: sumPreFood / reps, postFood: sumPostFood / reps, effectPresentCount: present, reps,
          effectDurationAvg: present ? durSum / present : null, effectAmps: [...ampVals], container: lastContainer, useTicksMeasured };
      } else if (s.kind === 'drink_empty') {
        let sumPreFood = 0, sumPostFood = 0, lastContainer = null, useTicksMeasured = 0;
        for (let r = 0; r < reps; r++) {
          const pre = await snapshot();
          const { ticks } = await giveAndDrink(s.potion, s.useTicks);
          const post = await snapshot();
          useTicksMeasured = ticks;
          sumPreFood += pre.food; sumPostFood += post.food;
          if (r === 0) lastContainer = await hotbar0();
        }
        cases[s.id] = { preFood: sumPreFood / reps, postFood: sumPostFood / reps, container: lastContainer, useTicksMeasured };
      } else if (s.kind === 'drink_creative') {
        await C('gamemode creative pt0');
        let lastContainer = null, useTicksMeasured = 0;
        for (let r = 0; r < reps; r++) {
          const { ticks } = await giveAndDrink(s.potion, s.useTicks);
          useTicksMeasured = ticks;
          if (r === 0) lastContainer = await hotbar0();
        }
        cases[s.id] = { gamemode: 'creative', container: lastContainer, useTicksMeasured };
        await C('gamemode survival pt0');
      } else if (s.kind === 'drink_milk') {
        let clearedCount = 0, sumPreFood = 0, sumPostFood = 0, lastContainer = null, useTicksMeasured = 0;
        for (let r = 0; r < reps; r++) {
          await C('effect clear pt0');
          await C('effect give pt0 minecraft:poison 100 0 true');
          await sleep(150);
          const preHasPoison = hasEffect((await readRaw()), 19);
          await C(`item replace entity pt0 weapon.mainhand with minecraft:milk_bucket 1`);
          await sleep(150);
          const pre = await snapshot();
          const t0tick = await gametime();
          bot.useItem(0);
          await sleep(s.useTicks * 50 + 500);
          const t1tick = await gametime();
          useTicksMeasured = t1tick - t0tick;
          const post = await snapshot();
          sumPreFood += pre.food; sumPostFood += post.food;
          if (preHasPoison && !hasEffect(post.raw, 19)) clearedCount++;
          if (r === 0) lastContainer = await hotbar0();
        }
        cases[s.id] = { clearedCount, reps, preFood: sumPreFood / reps, postFood: sumPostFood / reps, container: lastContainer, useTicksMeasured };
      }
      console.log(`  ${s.id.padEnd(26)} ${JSON.stringify(cases[s.id])}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'player-potion', version: '1.18.2',
    clock: 'growbot survival player, one lane, a real Use Item (0x2f) packet per drink; healing/harming scenes reset to full HP each rep with an amplified instant_health (amp 10, /data merge on a player is refused outright, same guard the food pack found) then reach their own pre-state with real instant_damage hits; milk scene reaches its pre-poisoned state with /effect give -- never a number this file invented',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-potion.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runpotion: ${golden.seconds} s -> ${join(dir, 'player-potion.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
