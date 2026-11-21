#!/usr/bin/env node
// runmelee.mjs — the referee's MOB MELEE runner (infra W, 25 Sept 2026). Scenarios: meleescen.mjs.
//
//   node tools/referee/runmelee.mjs
//
// Per (armour tier x rep): heal+clear every lane's bot (`instant_health` amplifier 5 -- always a full
// heal regardless of the previous hit, `/data merge entity` on a player being refused, per the unit's
// own dispatch), kill any leftover attacker, summon a fresh one 1 block away (AI on, PersistenceRequired),
// read Health x100 before, wait T ticks (one bounded wait on the server WE started, D-436), read Health
// x100 after and the three tracked effects' presence (ActiveEffects raw id, no datapack needed --
// `execute store ... if entity <bot>[nbt={ActiveEffects:[{Id:<n>b}]}]` is a complete RCON command on its
// own). No datapack, no forceload beyond the lanes' own chunks (the bots themselves keep those loaded,
// same as growbot.mjs's own header). Own port 25651 + work dir; golden -> <referee dir>/golden/mob-melee.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { REPS, T, PITCH, Y, ARMOR, ARMOR_TIERS as ARMOR_TIERS_ALL, MOBS, EFFECT_RAWID, DIFF_EXTRA, DIFF_MOBS } from './meleescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBUG = !!process.env.MCLITE_MELEE_DEBUG;
const ARMOR_TIERS = process.env.MCLITE_MELEE_TIERS ? process.env.MCLITE_MELEE_TIERS.split(',') : ARMOR_TIERS_ALL;
const REPS_OVERRIDE = process.env.MCLITE_MELEE_REPS ? parseInt(process.env.MCLITE_MELEE_REPS, 10) : REPS;

async function main() {
  const workDir = process.env.MCLITE_MELEE_WORKDIR || join(homedir(), '.mclite-referee-melee');
  // A world saved between runs can leave a dead bot (no respawn packet this offline client can ever
  // send) or leftover un-`refmelee`-tagged attackers from an earlier interrupted run, both of which
  // silently zero out every "before" health read -- always start from a clean world.
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25651, rconPort: 26651, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  const laneOf = (k) => k * PITCH;
  const botName = (k) => `mm${k}`;

  let rcon;
  const bots = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false',
      `forceload add -8 -8 ${laneOf(MOBS.length) + 8} 8`, 'difficulty normal']) await C(c);

    for (let k = 0; k < MOBS.length; k++) {
      const bot = await connectFakePlayer({ port: server.port, name: botName(k) });
      bots.push(bot);
      const x = laneOf(k) + 0.5;
      await C(`gamemode survival ${botName(k)}`);
      await C(`tp ${botName(k)} ${x} ${Y} 0.5 0 0`);
    }
    const stillUp = bots.filter((b) => !b.closed).length;
    if (stillUp !== MOBS.length) notes.push(`only ${stillUp}/${MOBS.length} referee players stayed connected`);
    await sleep(500);

    async function equip(tier) {
      const pieces = ARMOR[tier];
      const enchant = tier === 'diamond_prot4' ? '{Enchantments:[{id:"minecraft:protection",lvl:4s}]}' : '';
      for (let k = 0; k < MOBS.length; k++) {
        const b = botName(k);
        for (const slot of ['feet', 'legs', 'chest', 'head']) await C(`item replace entity ${b} armor.${slot} with air`);
        for (const it of pieces) {
          const slot = it.split('_')[1] === 'boots' ? 'feet' : it.split('_')[1] === 'leggings' ? 'legs'
            : it.split('_')[1] === 'chestplate' ? 'chest' : 'head';
          const r = await C(`item replace entity ${b} armor.${slot} with minecraft:${it}${enchant}`);
          if (/Unknown|Invalid|Incorrect|expected/i.test(r)) notes.push(`equip ${b} ${it}: ${r.trim().slice(0, 100)}`);
        }
      }
    }

    async function runRep(scenarios, tag) {
      // scenarios: [{key, laneK}] -- lane K's own MOBS[k] is what gets summoned there.
      for (const { key, laneK } of scenarios) {
        const b = botName(laneK);
        // ⚠ THE PREVIOUS HIT'S KNOCKBACK IS STILL ON THE BOT (`Mob.tryAttack` pushes the DEFENDER,
        // .decomp MobEntity.java:1324-1332) -- re-teleport to the lane origin EVERY rep, not just
        // once at setup, or drift compounds rep over rep until the fresh attacker (spawned at the
        // lane's fixed offset) is too far from the drifted bot to reach inside the poll window. This
        // was the first version's own bug: tier 'none' rep 0 landed hits, every rep after it (and
        // every later armour tier) read NO-HIT across the board.
        await C(`tp ${b} ${laneOf(laneK) + 0.5} ${Y} 0.5 0 0`);
        await C(`effect clear ${b}`);
        await C(`effect give ${b} minecraft:instant_health 1 5`);
      }
      await C(`kill @e[tag=refmelee]`);
      await sleep(100);
      for (const { laneK } of scenarios) {
        const m = MOBS[laneK];
        const x = laneOf(laneK) + 1.5;
        const nbt = m.nbt ? ',' + m.nbt : '';
        // Each attacker carries its OWN lane tag (`refmelee0`, `refmelee1`, ...), not just the shared
        // `refmelee` -- once a lane's first hit is recorded below it is killed on the spot, or it goes
        // on attacking for the rest of the T-tick window and can kill the bot outright (a dead offline
        // client never sends a Client Status/respawn packet, so a bot that dies mid-run stays dead for
        // every rep after it -- this was the real cause of the first version's "everything after the
        // FIRST rep of the FIRST armour tier reads NO-HIT" bug, not knockback drift).
        const sr = await C(`summon minecraft:${m.mob} ${x} ${Y} 0.5 {Tags:["refmelee","refmelee${laneK}"],PersistenceRequired:1b${nbt}}`);
        if (DEBUG) console.error(`[dbg] ${tag} summon ${m.mob}@${laneK}: ${sr.trim()}`);
      }
      const health = (r) => { const v = /(-?[\d.]+)f?\s*$/.exec(r.trim()); return v ? Math.round(parseFloat(v[1]) * 100) : null; };
      const state = {};
      for (const { key, laneK } of scenarios) {
        const b = botName(laneK);
        const hr = await C(`data get entity ${b} Health`);
        if (DEBUG) console.error(`[dbg] ${tag} before ${key}: ${hr.trim()}`);
        state[key] = { laneK, b, before: health(hr), after: null, hitTick: null };
      }
      // Poll every 3 ticks (150ms) for the FIRST health drop per lane -- that drop IS the first hit
      // (vanilla melee cooldown means a second swing inside this window would double-count if we only
      // read before/after the whole T-tick window, which an earlier version of this runner did and
      // measured 2-3 zombie hits stacked into one number).
      const POLL_TICKS = 3;
      for (let t = 0; t < T; t += POLL_TICKS) {
        await sleep(POLL_TICKS * 50);
        let pending = 0;
        for (const key of Object.keys(state)) {
          const s = state[key];
          if (s.hitTick !== null) continue;
          pending++;
          const h = health(await C(`data get entity ${s.b} Health`));
          if (h !== null && s.before !== null && h < s.before) {
            s.after = h; s.hitTick = t + POLL_TICKS;
            await C(`kill @e[tag=refmelee${s.laneK}]`);   // stop it from landing a SECOND hit on our watch
            // s148: the applied effect's Duration, read the moment the hit is seen (<= POLL_TICKS + one
            // RCON round-trip after the hit) -- husk Hunger is 140 * (int)localDifficulty, cave_spider
            // Poison 7 s normal / 15 s hard (.decomp HuskEntity.tryAttack, CaveSpiderEntity.tryAttack).
            const we = MOBS[s.laneK].effect;
            if (we) {
              const dr = await C(`data get entity ${s.b} ActiveEffects[{Id:${EFFECT_RAWID[we]}b}].Duration`);
              const dm = /(-?\d+)\s*$/.exec(dr.trim());
              s.effDur = dm && /has the following/.test(dr) ? parseInt(dm[1], 10) : 0;
            }
          }
        }
        if (pending === 0) break;
      }
      const out = {};
      for (const { key, laneK } of scenarios) {
        const s = state[key];
        const effects = {};
        const wantEffect = MOBS[laneK].effect;
        if (wantEffect) {
          const rid = EFFECT_RAWID[wantEffect];
          // `execute if <test>` with no `run` clause is a complete command (since 1.13): it reports
          // "Test passed"/success or "Test failed" and does nothing else -- no datapack needed.
          const er = await C(`execute if entity @a[name=${s.b},nbt={ActiveEffects:[{Id:${rid}b}]}]`);
          effects[wantEffect] = /passed|success/i.test(er);
        }
        out[key] = { before: s.before, after: s.after === null ? s.before : s.after, hitTick: s.hitTick, effects, effDur: s.effDur === undefined ? null : s.effDur };
      }
      return out;
    }

    for (const tier of ARMOR_TIERS) {
      await equip(tier);
      for (let rep = 0; rep < REPS_OVERRIDE; rep++) {
        const scenarios = MOBS.map((m, k) => ({ key: `${m.id}@${tier}`, laneK: k }));
        const results = await runRep(scenarios, tier);
        for (const [key, r] of Object.entries(results)) {
          const c = cases[key] || (cases[key] = { armor: tier, mob: key.split('@')[0], difficulty: 'normal', before: [], after: [], effectHits: {}, noHit: 0 });
          c.before.push(r.before); c.after.push(r.after); (c.effDur || (c.effDur = [])).push(r.effDur);
          if (r.hitTick === null) c.noHit++;
          for (const [eff, hit] of Object.entries(r.effects)) c.effectHits[eff] = (c.effectHits[eff] || 0) + (hit ? 1 : 0);
        }
      }
    }

    // Extra difficulty pass (s148 widened from cave_spider alone): every DIFF_MOBS lane, tier 'none', easy/hard,
    // all lanes in one rep (normal is already the main matrix's own `<mob>@none`).
    await equip('none');
    for (const diff of DIFF_EXTRA) {
      await C(`difficulty ${diff}`);
      for (let rep = 0; rep < REPS_OVERRIDE; rep++) {
        const scen = DIFF_MOBS.map((id) => ({ key: `${id}@none@${diff}`, laneK: MOBS.findIndex((m) => m.id === id) }));
        const results = await runRep(scen, diff);
        for (const { key } of scen) {
          const r = results[key];
          const c = cases[key] || (cases[key] = { armor: 'none', mob: key.split('@')[0], difficulty: diff, before: [], after: [], effectHits: {}, noHit: 0 });
          c.before.push(r.before); c.after.push(r.after); (c.effDur || (c.effDur = [])).push(r.effDur);
          if (r.hitTick === null) c.noHit++;
          for (const [eff, hit] of Object.entries(r.effects)) c.effectHits[eff] = (c.effectHits[eff] || 0) + (hit ? 1 : 0);
        }
      }
    }
    await C('difficulty normal');
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }

  for (const [key, c] of Object.entries(cases)) {
    const lost = c.before.map((b, i) => (b == null || c.after[i] == null) ? null : (b - c.after[i]) / 100);
    console.log(`  ${key.padEnd(28)} lost ${lost.join('/')}  effects ${JSON.stringify(c.effectHits)}${c.effDur && c.effDur.some((v) => v != null) ? ' dur ' + c.effDur.join('/') : ''}${c.noHit ? `  NO-HIT x${c.noHit}` : ''}`);
    if (c.noHit === c.before.length) notes.push(`${key}: never landed a hit in ${REPS} reps within ${T} ticks`);
  }
  const golden = {
    pack: 'mob-melee', version: '1.18.2', REPS, T, scale: 100,
    clock: 'heal to full (instant_health amp 5) -> kill old attacker -> summon fresh 1 block away (AI on) -> read Health -> T ticks -> read Health + ActiveEffects',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mob-melee.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runmelee: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${join(dir, 'mob-melee.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
