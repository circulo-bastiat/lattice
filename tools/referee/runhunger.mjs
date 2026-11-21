#!/usr/bin/env node
// runhunger.mjs — the referee's PLAYER HUNGER / EXHAUSTION runner (infra W, 25 Sept 2026). Scenarios:
// hungerscen.mjs.
//   node tools/referee/runhunger.mjs      (9 scenes, one growbot survival player, ~30-60 s)
// ONE growbot survival player ('hg0', confirmTeleports so its own Player Position packets are honoured
// -- growbot.mjs's own note on why: without it the server drops every one while a teleport is pending
// and none of `jump()`/`increaseTravelMotionStats` ever run). REPS=1 (hungerscen.mjs): every formula
// under test here (HungerManager.update/eat, PlayerEntity.jump/increaseTravelMotionStats/attackEntity)
// is pure arithmetic with no RNG, so a second rep would only re-check float determinism another pack
// already owns -- and vanilla hands out no command to reset a player's foodLevel/saturation, so a
// second rep would need to carry the first rep's leftover hunger forward anyway.
//
// 'jump'/'move'/'attack' scenes read exhaustion BEFORE and AFTER one action and record the delta --
// all three stay under HungerManager's own 4.0-exhaustion spend line (see hungerscen.mjs's header), so
// nothing else can move the number in that window. 'regen'/'eat' scenes record the server's own
// PRE-state (health/food/saturation/exhaustion) alongside the POST-state after a fixed number of
// ticks/one real Use Item packet -- hungerrefcheck replays the engine from that recorded pre-state
// rather than trying to reproduce how the pre-state was reached (a `/effect` dent, a sprint burn).
//
// Own port 25721 / rcon 26721, work dir MCLITE_HUNGER_WORKDIR (default ~/.mclite-referee-hunger);
// golden -> <refereeWorkDir()>/golden/player-hunger.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, REPS, FLOOR } from './hungerscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X0 = 0.5;                 // dry floor lane: bot starts here, x grows
const WX0 = -40.5;              // water lane: a separate strip so the two never overlap
const AX0 = 10.5;               // a fixed spot for the jump/attack/regen/eat scenes (never moves)

async function main() {
  const workDir = process.env.MCLITE_HUNGER_WORKDIR || join(homedir(), '.mclite-referee-hunger');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true }); // a bot that died last run must not rejoin dead
  const server = await startServer({ workDir, port: 25721, rconPort: 26721, xmx: '1024M' });
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
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration true', 'forceload add -48 -16 48 16']) await C(c);
    // dry lane (jump/attack/regen/eat all sit on it too, at AX0) -- a long flat stone strip, ceiling clear
    await C(`fill -4 ${FLOOR - 1} -4 60 ${FLOOR + 5} 4 minecraft:air`);
    await C(`fill -4 ${FLOOR - 1} -4 60 ${FLOOR - 1} 4 minecraft:stone`);
    // water lane -- same shape, but 3 blocks of water sit right on the floor so the bot is submerged
    // the instant it is teleported in (touching/submerged water charge the SAME 0.01/block as swimming
    // -- PlayerEntity.java:1467-1479 -- so which exact branch fires does not matter here).
    await C(`fill -60 ${FLOOR - 1} -4 -20 ${FLOOR + 5} 4 minecraft:air`);
    await C(`fill -60 ${FLOOR - 1} -4 -20 ${FLOOR - 1} 4 minecraft:stone`);
    await C(`fill -60 ${FLOOR} -4 -20 ${FLOOR + 3} 4 minecraft:water`);
    await sleep(1000);
    bot = await connectFakePlayer({ port: server.port, name: 'hg0', confirmTeleports: true, captureVelocity: true }); // captureVelocity also turns on spawnedIds (the attack scene's target id)
    await sleep(1000);
    await C('gamemode survival hg0');
    await C(`tp hg0 ${AX0} ${FLOOR} 0.5 0 0`);
    let mode = 'stand', px = AX0, py = FLOOR, pz = 0.5;
    loop = setInterval(() => { if (!bot.closed && mode === 'stand') bot.sendPos(px, py, pz, true); }, 50);
    await sleep(1500);

    const readF = async (path) => { const m = /:\s*([-0-9.Ee]+)f?\s*$/.exec(await C(`data get entity hg0 ${path}`)); return m ? parseFloat(m[1]) : NaN; };
    const readI = async (path) => { const m = /:\s*(-?[0-9]+)\s*$/.exec(await C(`data get entity hg0 ${path}`)); return m ? parseInt(m[1], 10) : NaN; };
    const exhaustion = () => readF('foodExhaustionLevel');
    const foodLevel = () => readI('foodLevel');
    const satLevel = () => readF('foodSaturationLevel');
    const health = () => readF('Health');
    // `sleep(N*50ms)` is only ever approximately N real server ticks (RCON round-trips and the
    // event loop both add jitter) -- fine for jump/move/attack (their deltas don't depend on the
    // exact tick count, only on the ONE action landing), but 'regen' replays a fixed number of
    // Survival.tick() calls, and HungerManager.update's own spend/heal timers are tick-EXACT. So
    // 'regen' measures the real elapsed ticks with `/time query gametime` around its own wait,
    // rather than trusting the sleep duration, and records THAT as `ticks`.
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    // `readF`/`readI` are one RCON round-trip PER FIELD, and the world keeps ticking in the
    // background between them -- fine for 'jump'/'move'/'attack' (they only ever read ONE field
    // at a time) but NOT for 'regen', whose whole point is several fields (health/food/saturation/
    // exhaustion/foodTickTimer) all as of the SAME tick. `snapshot()` instead reads the bot's
    // WHOLE entity NBT in one command (`/data get entity hg0`, no path -- one atomic read) and
    // pulls every field out of that single string, so the five numbers agree with each other.
    const snapshot = async () => {
      const raw = await C('data get entity hg0');
      const g1 = (re) => { const m = re.exec(raw); return m ? m[1] : null; };
      return {
        health: parseFloat(g1(/Health:\s*([-0-9.Ee]+)f/)),
        food: parseInt(g1(/foodLevel:\s*(-?[0-9]+)/), 10),
        saturation: parseFloat(g1(/foodSaturationLevel:\s*([-0-9.Ee]+)f/)),
        exhaustion: parseFloat(g1(/foodExhaustionLevel:\s*([-0-9.Ee]+)f/)),
        foodTimer: parseInt(g1(/foodTickTimer:\s*(-?[0-9]+)/), 10),
      };
    };

    // Step N packets of `step` blocks each along +x (walk/sprint/jump/attack/regen all share this
    // lane -- one packet per tick, well inside the anti-cheat's ~10-blocks/tick speed ceiling).
    async function moveBy(dist, steps, opts) {
      const step = dist / steps;
      for (let i = 0; i < steps; i++) {
        px += step;
        bot.sendPos(px, py, pz, opts && opts.onGround !== undefined ? opts.onGround : true);
        await sleep(50);
      }
    }
    async function resetLane(x, y, z) {
      mode = 'idle';
      await C(`tp hg0 ${x} ${y} ${z} 0 0`);
      px = x; py = y; pz = z;
      mode = 'stand';
      await sleep(400);
    }

    for (const s of SCEN) {
      if (s.kind === 'jump') {
        await resetLane(AX0, FLOOR, 0.5);
        if (s.sprint) await bot.setSprinting(true);
        await sleep(200);
        const before = await exhaustion();
        mode = 'idle';
        bot.sendPos(px, py + 0.2, pz, false);   // dy>0, was on ground -> jump() fires (ServerPlayNetworkHandler.java:838)
        await sleep(300);
        const after = await exhaustion();
        bot.sendPos(px, py, pz, true);
        if (s.sprint) await bot.setSprinting(false);
        mode = 'stand';
        cases[s.id] = { before, after, delta: Math.round((after - before) * 1e6) / 1e6 };
      } else if (s.kind === 'move') {
        if (s.mode === 'swim') { await resetLane(WX0, FLOOR + 1.5, 0.5); }
        else { await resetLane(AX0, FLOOR, 0.5); if (s.mode === 'sprint') await bot.setSprinting(true); }
        await sleep(200);
        const before = await exhaustion();
        mode = 'idle';
        await moveBy(s.dist, s.dist, { onGround: s.mode !== 'swim' });
        await sleep(150);
        const after = await exhaustion();
        if (s.mode === 'sprint') await bot.setSprinting(false);
        mode = 'stand';
        cases[s.id] = { before, after, delta: Math.round((after - before) * 1e6) / 1e6 };
      } else if (s.kind === 'attack') {
        await resetLane(AX0, FLOOR, 0.5);
        await C('kill @e[type=!player]');
        await C(`item replace entity hg0 weapon.mainhand with minecraft:air`);
        await sleep(200);
        const n0 = bot.spawnedIds.length;
        await C(`summon minecraft:${s.target} ${AX0} ${FLOOR} 2.5 {NoAI:1b,PersistenceRequired:1b,Silent:1b,Tags:["hg_tg"],Attributes:[{Name:"minecraft:generic.max_health",Base:100d}],Health:100f}`);
        await sleep(1800);   // > the attack cooldown, so this lands at full strength
        const ids = bot.spawnedIds.slice(n0);
        if (!ids.length) { notes.push(`${s.id}: no spawn id seen`); cases[s.id] = { err: 'no spawn id' }; continue; }
        const targetHealth = async () => { const m = /:\s*([-0-9.Ee]+)f?\s*$/.exec(await C(`data get entity @e[tag=hg_tg,limit=1] Health`)); return m ? parseFloat(m[1]) : NaN; };
        const before = await exhaustion();
        let landed = false, after = before;
        for (let attempt = 0; attempt < 3 && !landed; attempt++) {
          const h0 = await targetHealth();
          bot.attack(ids[0]);
          await sleep(600);
          const h1 = await targetHealth();
          after = await exhaustion();
          landed = h1 < h0 - 0.0001;
          if (!landed) notes.push(`${s.id}: attempt ${attempt} did not land (target health ${h0} -> ${h1}), retrying`);
        }
        if (!landed) { cases[s.id] = { err: 'attack never landed after 3 attempts' }; await C('kill @e[type=!player]'); continue; }
        cases[s.id] = { before, after, delta: Math.round((after - before) * 1e6) / 1e6 };
        await C('kill @e[type=!player]');
      } else if (s.kind === 'regen') {
        await resetLane(AX0, FLOOR, 0.5);
        await C('effect clear hg0');
        await C(`effect give hg0 minecraft:instant_health 1 10 true`); // top HP up first: a clean, known "before" for every scene
        await sleep(150);
        // InstantDamageStatusEffect (harming): 6 * 2^amplifier against a non-undead target, so
        // amplifier 0 is exactly `s.damage`=6 -- hungerscen.mjs's own constant, not re-derived here.
        const amp = Math.round(Math.log2(s.damage / 6));
        await C(`effect give hg0 minecraft:instant_damage 1 ${amp} true`);
        await sleep(150);
        // `foodTickTimer` is HungerManager's own regen countdown, and `HungerManager.writeNbt`
        // (.decomp HungerManager.java:85-90) saves it right alongside foodLevel/Health -- reading
        // it here means the engine replay does not have to land on the exact SAME real tick the
        // damage applied on (impossible to guarantee over RCON's own latency): it just starts its
        // own `Survival.tick()` loop from the timer value the server had already reached.
        const t0tick = await gametime();
        const pre = await snapshot();
        await sleep(s.ticks * 50 + 100);
        const t1tick = await gametime();
        const post = await snapshot();
        const ticks = t1tick - t0tick;   // the REAL elapsed tick count (see `gametime`'s own comment) -- not `s.ticks`
        cases[s.id] = { preHealth: pre.health, preFood: pre.food, preSaturation: pre.saturation, preExhaustion: pre.exhaustion, preFoodTimer: pre.foodTimer,
          ticks, postHealth: post.health, postExhaustion: post.exhaustion, postFood: post.food, postSaturation: post.saturation };
        await C(`effect give hg0 minecraft:instant_health 1 10 true`);
        await sleep(150);
      } else if (s.kind === 'add') {
        // HungerManager.add(nutrition, 1.0F) via `minecraft:saturation` -- see hungerscen.mjs's
        // header for why this stands in for a real Use Item packet. Sprint-burn first so the
        // scene lands somewhere with food well under 20 (exercises the UNclamped branch) and,
        // for the second scene, close enough to 20 that food+nutrition also brushes the ceiling.
        await resetLane(AX0, FLOOR, 0.5);
        await bot.setSprinting(true);
        mode = 'idle';
        await moveBy(s.burnBlocks, Math.round(s.burnBlocks / 5), { onGround: true });
        await bot.setSprinting(false);
        mode = 'stand';
        await sleep(300);
        const preFood = await foodLevel(), preSaturation = await satLevel();
        await C(`effect give hg0 minecraft:saturation 1 ${s.nutrition - 1} true`); // amplifier = nutrition - 1 (empirically confirmed: amp4 -> add(5, 1.0))
        await sleep(200);
        const postFood = await foodLevel(), postSaturation = await satLevel();
        cases[s.id] = { preFood, preSaturation, nutrition: s.nutrition, modifier: 1.0, postFood, postSaturation };
        if (postSaturation === preSaturation) notes.push(`${s.id}: saturation did not change -- the saturation-effect stand-in may not be working the way runhunger.mjs's own smoke check found`);
      }
      const c = cases[s.id];
      console.log(`  ${s.id.padEnd(20)} ${JSON.stringify(c)}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'player-hunger', version: '1.18.2', REPS,
    clock: 'growbot survival player, one lane; jump/move/attack: exhaustion delta around one action (all under the 4.0 spend line); regen/eat: server pre-state recorded then replayed by the engine, post-state after a fixed tick count or one real Use Item packet',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-hunger.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runhunger: ${golden.seconds} s -> ${join(dir, 'player-hunger.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
