#!/usr/bin/env node
// runfood.mjs — the referee's PLAYER FOOD + STARVATION runner (infra W, 25 Sept 2026). Scenarios:
// foodscen.mjs. Follow-on to runhunger.mjs (same growbot, same one-lane pattern) -- this pack's own
// addition is a REAL Use Item packet (growbot.mjs's new `useItem()`) driving actual eating, rather
// than the hunger pack's `minecraft:saturation`-effect stand-in.
//
// ⚠ `/data merge entity <player>` REFUSES ("Unable to modify player data") -- confirmed empirically
// (a real vanilla anti-cheat guard: DataCommand only allows `get` on a player, never `modify`).
// So unlike a mob, a player's foodLevel/Health cannot be poked directly; every pre-state here is
// reached the SAME way a real player would reach it: sprinting to spend exhaustion (food ->
// HungerManager's own add()/spend formula, exactly the hunger pack's own 'add' scene technique) and
// `/effect give ... instant_damage` for damage (the hunger pack's own 'regen' scene technique) --
// never a number this file invented.
//
//   node tools/referee/runfood.mjs      (15 scenarios, one growbot survival player, ~5 min)
//
// Own port 25851 / rcon 26851, work dir ~/.mclite-referee-food; golden -> golden/player-food.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN } from './foodscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AX0 = 10.5, AZ0 = 0.5; // fixed spot, never moves -- eating and starvation both sit here

async function main() {
  const workDir = process.env.MCLITE_FOOD_WORKDIR || join(homedir(), '.mclite-referee-food');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true }); // a bot that died last run must not rejoin dead
  const server = await startServer({ workDir, port: 25851, rconPort: 26851, xmx: '1024M' });
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
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration true', 'forceload add -16 -16 40 16']) await C(c);
    // a short flat lane, wide enough for sprintBurn's own back-and-forth (amplitude 20 either side
    // of AX0) -- NOT a straight 2400-block line (the first cut here sent the bot off the edge of a
    // narrow platform into the void and the server removed it -- "No entity was found" on every
    // read after, an empirical dead end logged here so it is not retried).
    await C(`fill -12 -17 -4 34 -12 4 minecraft:air`);
    await C(`fill -12 -17 -4 34 -17 4 minecraft:stone`);
    await sleep(1000);
    bot = await connectFakePlayer({ port: server.port, name: 'fd0', confirmTeleports: true, captureVelocity: true });
    await sleep(1000);
    await C('gamemode survival fd0');
    await C(`tp fd0 ${AX0} -16 ${AZ0} 0 0`);
    let px = AX0, py = -16, pz = AZ0, mode = 'stand';
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(px, py, pz, true); }, 50);
    await sleep(1500);

    const readRaw = async () => C('data get entity fd0');
    const snapshot = async () => {
      const raw = await readRaw();
      const g1 = (re) => { const m = re.exec(raw); return m ? m[1] : null; };
      return {
        health: parseFloat(g1(/Health:\s*([-0-9.Ee]+)f/)),
        food: parseInt(g1(/foodLevel:\s*(-?[0-9]+)/), 10),
        saturation: parseFloat(g1(/foodSaturationLevel:\s*([-0-9.Ee]+)f/)),
        exhaustion: parseFloat(g1(/foodExhaustionLevel:\s*([-0-9.Ee]+)f/)),
        foodTimer: parseInt(g1(/foodTickTimer:\s*(-?[0-9]+)/), 10),
        raw,
      };
    };
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    const hotbar0 = async () => {
      const raw = await C('data get entity fd0 Inventory[{Slot:0b}]');
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

    async function resetLane() {
      mode = 'idle';
      await C(`tp fd0 ${AX0} -16 ${AZ0} 0 0`);
      px = AX0; py = -16; pz = AZ0;
      mode = 'stand';
      await sleep(300);
    }
    // Sprint a straight line of `dist` blocks (one packet per tick, well inside the anti-cheat's
    // ~10-blocks/tick speed ceiling -- runhunger.mjs's own 'add' scene technique) to spend enough
    // exhaustion (0.1/block sprinting, PlayerEntity.increaseTravelMotionStats) to drain BOTH the
    // starting saturation (5.0, five 4.0-exhaustion crossings) and however much of foodLevel is
    // asked for (`crossings` more 4.0 crossings after that, each one point of food).
    // Oscillates +/-20 blocks around the lane's CURRENT spot rather than walking a straight line --
    // exhaustion is charged on DISTANCE TRAVELLED regardless of direction (increaseTravelMotionStats
    // takes `cm`, an unsigned magnitude), so bouncing inside a short, safe platform burns the same
    // exhaustion as walking off in a straight line would, without needing a 2400-block-long floor.
    async function sprintBurn(dist) {
      await bot.setSprinting(true);
      mode = 'idle';
      const AMP = 18, STEP = 8;
      let x = px, dir = 1, traveled = 0;
      while (traveled < dist) {
        x += dir * STEP;
        if (x > px + AMP) { x = px + AMP; dir = -1; }
        if (x < px - AMP) { x = px - AMP; dir = 1; }
        bot.sendPos(x, py, pz, true);
        traveled += STEP;
        await sleep(50);
      }
      await bot.setSprinting(false);
      mode = 'stand';
      await sleep(200);
    }
    async function giveAndEat(item, useTicks) {
      await C(`item replace entity fd0 weapon.mainhand with minecraft:${item} 1`);
      await sleep(150);
      bot.useItem(0);
      await sleep(useTicks * 50 + 500); // hold through the full server-side use time (LivingEntity.tickActiveItemStack), plus margin
    }

    for (const s of SCEN) {
      if (s.kind === 'eat' || s.kind === 'eat_container' || s.kind === 'eat_stat' || s.kind === 'eat_effects') {
        await resetLane();
        const reps = s.reps || 1;
        let sumPreFood = 0, sumPreSat = 0, sumPostFood = 0, sumPostSat = 0, effectHits = 0;
        let lastContainer = null, poisonCured = null;
        for (let r = 0; r < reps; r++) {
          await C('effect clear fd0');
          // A food item at less-than-full FoodComponent.alwaysEdible() gates eating on `foodLevel
          // < 20` (HungerManager.isNotFull, `Sv.canEat` mirrors it) -- and a fresh spawn is ALWAYS
          // full. Confirmed empirically the first cut here: with no burn every eat scene came back
          // a no-op (postFood === preFood === 20 for every non-alwaysEdible item, including bread),
          // because the real server was silently refusing to let a full player eat at all, not
          // because Use Item was doing anything wrong. A short burn (well under the ~25-crossing,
          // 1000-block burn `starve_cadence` uses to floor food at 0) is all "hungry enough to eat"
          // needs.
          await sprintBurn(400);
          if (s.curesPoison) { await C('effect give fd0 minecraft:poison 100 0 true'); await sleep(150); }
          const pre = await snapshot();
          await giveAndEat(s.item, s.useTicks);
          const post = await snapshot();
          sumPreFood += pre.food; sumPreSat += pre.saturation; sumPostFood += post.food; sumPostSat += post.saturation;
          if (s.kind === 'eat_stat' && hasEffect(post.raw, s.effectId)) effectHits++;
          if (s.kind === 'eat_effects' && r === 0) cases[s.id] = { preFood: pre.food, preSaturation: pre.saturation, postFood: post.food, postSaturation: post.saturation,
              effects: s.effects.map((ef) => ({ id: ef.id, present: hasEffect(post.raw, ef.id), duration: effectDuration(post.raw, ef.id) })) };
          if (s.kind === 'eat_container') { lastContainer = await hotbar0(); if (s.curesPoison) poisonCured = !hasEffect(post.raw, 19); }
        }
        if (s.kind === 'eat') cases[s.id] = { preFood: sumPreFood / reps, preSaturation: sumPreSat / reps, postFood: sumPostFood / reps, postSaturation: sumPostSat / reps };
        else if (s.kind === 'eat_container') cases[s.id] = { preFood: sumPreFood / reps, preSaturation: sumPreSat / reps, postFood: sumPostFood / reps, postSaturation: sumPostSat / reps,
          container: lastContainer, poisonCured };
        else if (s.kind === 'eat_stat') cases[s.id] = { preFood: sumPreFood / reps, preSaturation: sumPreSat / reps, postFood: sumPostFood / reps, postSaturation: sumPostSat / reps,
          reps, effectHits };
        console.log(`  ${s.id.padEnd(22)} ${JSON.stringify(cases[s.id])}`);
      } else if (s.kind === 'starve') {
        await resetLane();
        await C(`difficulty ${s.difficulty}`);
        await C('effect clear fd0');
        // Reach LOW food: a long sprint burns through starting saturation (5.0) then straight
        // through food (see sprintBurn's own comment) -- 2400 blocks is comfortably past the ~25
        // crossings (100.0 exhaustion) needed to floor food at 0 from a fresh spawn. Only the FIRST
        // starvation scene burns: food never gets eaten again after it, so it stays floored at 0 for
        // every scene that follows (these four scenes CHAIN, foodscen.mjs's own header explains why).
        if (s.burn) await sprintBurn(2400);
        // Reach the scene's own STARTING health with real damage, not a number this file invented:
        // `/effect give ... instant_damage 1 0 true` is InstantDamageStatusEffect amplifier 0 --
        // 6 * 2^0 = 6 damage to a non-undead target (hungerscen.mjs's own 'regen' scenes derive the
        // same constant) -- spaced past the ~10-tick same-strength invulnerability window (a
        // same-or-weaker hit inside it is dropped outright, not partially applied).
        for (let i = 0; i < s.hits; i++) { await C('effect give fd0 minecraft:instant_damage 1 0 true'); await sleep(800); }
        await sleep(200);
        const t0tick = await gametime();
        const pre = await snapshot();
        await sleep(s.waitTicks * 50 + 300);
        const t1tick = await gametime();
        const post = await snapshot();
        const ticks = t1tick - t0tick;
        // `foodTimer` is HungerManager's own 80-tick starvation countdown, and it does NOT reset to
        // 0 when a starve scene starts -- food has been floored at 0 since 'starve_cadence' (these
        // four scenes CHAIN), so whatever fraction of the current 80-tick cycle was already elapsed
        // carries in. Recording it (hungerrefcheck's own 'regen' scenes set the same precedent) is
        // what lets the engine replay start from the SAME point in the cycle the server was at,
        // rather than assuming a fresh 0 that would misalign every scene after the first by up to
        // 79 ticks.
        cases[s.id] = { difficulty: s.difficulty, preHealth: pre.health, preFood: pre.food, preSaturation: pre.saturation,
          preExhaustion: pre.exhaustion, preFoodTimer: pre.foodTimer, ticks, postHealth: post.health, dead: post.health <= 0 };
        console.log(`  ${s.id.padEnd(22)} ${JSON.stringify(cases[s.id])}`);
        await C('difficulty normal');
      }
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'player-food', version: '1.18.2',
    clock: 'growbot survival player, one lane, a real Use Item (0x2f) packet per eat; starvation scenes reach their own pre-state with a sprint burn (food) and spaced instant_damage hits (health) -- never /data merge, which vanilla refuses on a player -- then wait a fixed real tick count (measured via /time query gametime)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-food.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runfood: ${golden.seconds} s -> ${join(dir, 'player-food.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
